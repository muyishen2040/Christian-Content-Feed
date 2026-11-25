import { z } from "zod";

// Two separate consents (docs/api-contracts.md). consentStorePreferences is stored in
// user_profiles.consent_to_personalization; consentKeepText in user_profiles.consent_keep_text.
export const consentInputSchema = z
  .strictObject({
    consentStorePreferences: z.boolean(),
    consentKeepText: z.boolean(),
  })
  .refine((c) => !c.consentKeepText || c.consentStorePreferences, {
    message: "consentKeepText requires consentStorePreferences",
    path: ["consentKeepText"],
  });

export type ConsentState = z.infer<typeof consentInputSchema>;

export const NO_CONSENT: ConsentState = {
  consentStorePreferences: false,
  consentKeepText: false,
};

/** Columns to write when consent changes. Withdrawing consent also clears what it covered, so the
 * database never holds durable preference state or retained text without matching consent. The
 * database enforces the same rule with CHECK constraints (migration 20261124000000). */
export function consentRowPatch(
  consent: ConsentState,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    consent_to_personalization: consent.consentStorePreferences,
    consent_keep_text: consent.consentKeepText,
  };
  if (!consent.consentStorePreferences) {
    patch.topics = [];
    patch.preference_embedding = null;
    patch.preference_model_version = null;
  }
  if (!consent.consentKeepText) patch.description_ciphertext = null;
  return patch;
}

export function consentFromRow(row: unknown): ConsentState {
  const r = (row ?? {}) as Record<string, unknown>;
  const store = r.consent_to_personalization === true;
  return {
    consentStorePreferences: store,
    consentKeepText: store && r.consent_keep_text === true,
  };
}
