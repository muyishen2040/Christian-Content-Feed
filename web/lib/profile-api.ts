import { isTrustedMutation } from "./csrf.ts";
import { profileInputSchema, type ProfileResponse } from "./contracts.ts";
import { consentRowPatch, type ConsentState } from "./consent.ts";

// Handlers take their dependencies as arguments so they can be tested without Next.js, a database or
// the embedding service. The real wiring (service-role client, embedding client, encryption) is in
// profile-server.ts.
//
// Privacy rules enforced here:
// - the user id comes only from the verified session, never from the request;
// - the description is used only in memory: it is encrypted (and only on explicit opt-in) before any
//   database call, embedded by our own private service, and never logged, echoed or stored for retry;
// - age range and gender are validated and then discarded: they are never stored or used for ranking;
// - nothing here screens the description for crisis signals, so safetyState is always "normal".

export interface EmbeddingResult {
  vector: number[];
  model: string;
  revision: string;
  export_revision: string;
}

/** The columns of user_profiles this API reads. */
export interface ProfileRow {
  consent_to_personalization: boolean;
  consent_keep_text: boolean;
  topics: string[];
  has_preference: boolean;
  /** The encrypted description as stored (a `\x…` hex string), or null. */
  description_ciphertext: string | null;
}

export interface ProfileDeps {
  /** The verified current visitor (checked with the Auth server), or null. Throws on a temporary failure. */
  getUser(): Promise<{ id: string } | null>;
  readProfile(userId: string): Promise<ProfileRow | null>;
  /** Upserts the given columns for the user. */
  writeProfile(userId: string, patch: Record<string, unknown>): Promise<void>;
  deleteProfile(userId: string): Promise<void>;
  /** Encrypts for this user. Returns null unless keeping text is consented. Throws if the key is missing. */
  encrypt(
    userId: string,
    text: string | null,
    consentToKeepText: boolean,
  ): string | null;
  /** Decrypts text that belongs to this (already authenticated) user. Throws on failure. */
  decrypt(userId: string, ciphertext: string): string;
  /** Embeds in the private embedding service. Null when it is unavailable or its answer is invalid. */
  embed(text: string): Promise<EmbeddingResult | null>;
}

// 2000-character description and twelve 60-character topics, at up to four bytes each, plus JSON.
const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

const forbidden = () =>
  error(403, "forbidden_origin", "Cross-site request refused");
const unauthorized = () => error(401, "no_session", "No visitor session");
const unavailable = () => error(503, "profile_unavailable", "Try again later");

const DEFAULT_RESPONSE: ProfileResponse = {
  profile: null,
  safetyState: "normal",
  feedMode: "default",
};

export function preferenceModelVersion(e: EmbeddingResult): string {
  return `${e.model}@${e.revision}/${e.export_revision}`;
}

/** pgvector text form, which PostgREST accepts for a vector column. */
function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** Row columns for a profile save. Nothing in the patch is raw text: the description is ciphertext. */
export function profileRowPatch(
  consent: ConsentState,
  topics: string[],
  embedding: EmbeddingResult | null,
  ciphertext: string | null,
): Record<string, unknown> {
  if (!consent.consentStorePreferences) return consentRowPatch(consent);
  return {
    consent_to_personalization: true,
    consent_keep_text: consent.consentKeepText,
    topics,
    // A replaced description invalidates the old vector, so it is cleared even when embedding fails.
    preference_embedding: embedding ? vectorLiteral(embedding.vector) : null,
    preference_model_version: embedding
      ? preferenceModelVersion(embedding)
      : null,
    description_ciphertext: consent.consentKeepText ? ciphertext : null,
  };
}

function feedMode(row: {
  topics: string[];
  has_preference: boolean;
}): "personalized" | "default" {
  return row.has_preference || row.topics.length > 0
    ? "personalized"
    : "default";
}

/** GET /api/profile: only what the visitor chose to keep. Without a session or a retained profile it is
 * `profile: null` in default mode, not an error. Decryption happens only after the session is verified
 * and only for that user's own row. */
export async function handleGetProfile(deps: ProfileDeps): Promise<Response> {
  try {
    const user = await deps.getUser();
    if (!user) return json(DEFAULT_RESPONSE);
    const row = await deps.readProfile(user.id);
    if (!row || !row.consent_to_personalization) return json(DEFAULT_RESPONSE);
    const keepText = row.consent_keep_text;
    let description: string | null = null;
    if (keepText && row.description_ciphertext) {
      try {
        description = deps.decrypt(user.id, row.description_ciphertext);
      } catch {
        // Fail closed: returning no text would let an edit silently overwrite what the visitor kept.
        return error(503, "retention_unavailable", "Try again later");
      }
    }
    const body: ProfileResponse = {
      profile: {
        description,
        topics: row.topics,
        consentStorePreferences: true,
        consentKeepText: keepText,
      },
      safetyState: "normal",
      feedMode: feedMode(row),
    };
    return json(body);
  } catch {
    return unavailable();
  }
}

/** PUT /api/profile: submit or edit the profile. A full replacement. Empty fields are valid and give
 * the default feed. */
export async function handlePutProfile(
  request: Request,
  deps: ProfileDeps,
): Promise<Response> {
  if (!isTrustedMutation(request)) return forbidden();
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return error(400, "invalid_request", "Request body too large");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return error(400, "invalid_request", "Invalid JSON");
    }
    const parsed = profileInputSchema.safeParse(body);
    if (!parsed.success) {
      // Never reflect the issues: they can quote submitted values.
      return error(400, "invalid_request", "Invalid profile");
    }
    // ageRange and gender are intentionally dropped here (not stored, not used in ranking).
    const { topics, consentStorePreferences, consentKeepText } = parsed.data;
    const description = parsed.data.description || null;
    const consent: ConsentState = { consentStorePreferences, consentKeepText };

    const user = await deps.getUser();
    if (!consentStorePreferences) {
      // Nothing may be kept. A visitor who has a session also withdraws what the old consent covered.
      if (user) await deps.writeProfile(user.id, consentRowPatch(consent));
      return json(DEFAULT_RESPONSE);
    }
    if (!user) return unauthorized();

    // Encrypt first: a missing key fails before the text goes to the embedding service or the database.
    let ciphertext: string | null;
    try {
      ciphertext = deps.encrypt(user.id, description, consentKeepText);
    } catch {
      return error(503, "retention_unavailable", "Try again later");
    }

    // On failure the embedding is null: the visitor gets the default feed and may resubmit later. The
    // text is not queued or stored for retry.
    const embedding = description ? await deps.embed(description) : null;

    await deps.writeProfile(
      user.id,
      profileRowPatch(consent, topics, embedding, ciphertext),
    );
    const result: ProfileResponse = {
      profile: {
        description: consentKeepText ? description : null,
        topics,
        consentStorePreferences,
        consentKeepText,
      },
      safetyState: "normal",
      feedMode: feedMode({ topics, has_preference: embedding !== null }),
    };
    return json(result);
  } catch {
    return unavailable();
  }
}

/** DELETE /api/profile: remove the visitor's profile row, including preferences and retained ciphertext.
 * Idempotent. Deleting the Auth user itself is the reset/deletion work (MUY-34). */
export async function handleDeleteProfile(
  request: Request,
  deps: ProfileDeps,
): Promise<Response> {
  if (!isTrustedMutation(request)) return forbidden();
  try {
    const user = await deps.getUser();
    if (!user) return unauthorized();
    await deps.deleteProfile(user.id);
    return json({ ok: true });
  } catch {
    return unavailable();
  }
}
