import { isTrustedMutation } from "./csrf.ts";
import {
  consentInputSchema,
  NO_CONSENT,
  type ConsentState,
} from "./consent.ts";

// Handlers take their dependencies as arguments so they can be tested without Next.js or a database.
export interface SessionDeps {
  /** The verified current visitor (checked with the Auth server), or null. */
  getUser(): Promise<{ id: string } | null>;
  /** Creates an anonymous Supabase Auth session and sets its cookies. */
  signInAnonymously(): Promise<{ id: string } | null>;
  readConsent(userId: string): Promise<ConsentState>;
  writeConsent(userId: string, consent: ConsentState): Promise<void>;
}

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

const forbidden = () =>
  error(403, "forbidden_origin", "Cross-site request refused");
const unauthorized = () => error(401, "no_session", "No visitor session");

/** GET /api/session: does this browser have a session? Never creates one, so ordinary visitors and
 * bots reading public content do not create Auth users. */
export async function handleGetSession(deps: SessionDeps): Promise<Response> {
  return json({ hasSession: (await deps.getUser()) !== null });
}

/** POST /api/session: create an anonymous session, only when the visitor takes an action that needs
 * one (opting in, saving). No signup page, email or password. Idempotent. */
export async function handleCreateSession(
  request: Request,
  deps: SessionDeps,
): Promise<Response> {
  if (!isTrustedMutation(request)) return forbidden();
  try {
    if (await deps.getUser()) return json({ hasSession: true });
    const created = await deps.signInAnonymously();
    if (!created) return error(503, "session_unavailable", "Try again later");
    return json({ hasSession: true }, 201);
  } catch {
    return error(503, "session_unavailable", "Try again later");
  }
}

/** GET /api/consent: the visitor's own consent flags. A visitor with no session has no consent. */
export async function handleGetConsent(deps: SessionDeps): Promise<Response> {
  try {
    const user = await deps.getUser();
    if (!user) return unauthorized();
    return json({ consent: await deps.readConsent(user.id) });
  } catch {
    return error(503, "consent_unavailable", "Try again later");
  }
}

/** PUT /api/consent: set the visitor's own consent. The user id always comes from the verified
 * session, never from the request body. Withdrawing consent clears what it covered. */
export async function handlePutConsent(
  request: Request,
  deps: SessionDeps,
): Promise<Response> {
  if (!isTrustedMutation(request)) return forbidden();
  try {
    const user = await deps.getUser();
    if (!user) return unauthorized();
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
    const parsed = consentInputSchema.safeParse(body);
    if (!parsed.success) {
      return error(400, "invalid_request", "Invalid consent");
    }
    await deps.writeConsent(user.id, parsed.data);
    return json({ consent: parsed.data });
  } catch {
    return error(503, "consent_unavailable", "Try again later");
  }
}

export { NO_CONSENT };
