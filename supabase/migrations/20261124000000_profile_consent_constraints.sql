-- MUY-26: make the two consents explicit and enforce them in the database.
-- consent_to_personalization = consentStorePreferences (durable preference state).
-- consent_keep_text          = consentKeepText (retaining the encrypted original description).
-- Without the matching consent, durable preference state and retained text cannot exist in this table,
-- even if an API bug tried to write them. Profile writes stay server-only (service role).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS consent_keep_text boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS profiles_keep_text_needs_preference_consent,
  DROP CONSTRAINT IF EXISTS profiles_preferences_need_consent,
  DROP CONSTRAINT IF EXISTS profiles_text_needs_consent;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT profiles_keep_text_needs_preference_consent
    CHECK (NOT consent_keep_text OR consent_to_personalization),
  ADD CONSTRAINT profiles_preferences_need_consent
    CHECK (consent_to_personalization OR (
      cardinality(topics) = 0 AND preference_embedding IS NULL
      AND preference_model_version IS NULL AND description_ciphertext IS NULL)),
  ADD CONSTRAINT profiles_text_needs_consent
    CHECK (consent_keep_text OR description_ciphertext IS NULL);

-- A visitor may read their own consent flags (never write them, and never read the ciphertext).
GRANT SELECT (consent_keep_text) ON public.user_profiles TO authenticated;
