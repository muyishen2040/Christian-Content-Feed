-- Existing plaintext must be migrated explicitly before this schema change.
DO $$
BEGIN
  LOCK TABLE public.user_profiles IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
      AND column_name = 'description'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE description IS NOT NULL) THEN
      RAISE EXCEPTION 'Existing profile descriptions require a private migration';
    END IF;
    ALTER TABLE public.user_profiles DROP COLUMN description;
  END IF;

  ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS description_ciphertext bytea;

  REVOKE ALL ON public.user_profiles FROM PUBLIC, anon, authenticated;
  GRANT SELECT (user_id, topics, consent_to_personalization,
    preference_embedding, preference_model_version, created_at, updated_at)
    ON public.user_profiles TO authenticated;
  GRANT DELETE ON public.user_profiles TO authenticated;
END $$;
