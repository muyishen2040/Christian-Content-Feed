-- Verify that an upgrade never deletes an existing plaintext description.
\set ON_ERROR_STOP on
BEGIN;
\ir ../migrations/20261116050000_encrypt_profile_descriptions.sql
ALTER TABLE public.user_profiles ADD COLUMN description text;
INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-0000000000c3',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
INSERT INTO public.user_profiles (user_id, description)
VALUES ('00000000-0000-4000-8000-0000000000c3', 'fictional migration fixture');

SAVEPOINT before_upgrade;
\set ON_ERROR_STOP off
\ir ../migrations/20261116050000_encrypt_profile_descriptions.sql
\set migration_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT before_upgrade;
SELECT 1 / CASE WHEN :'migration_sqlstate' = 'P0001' THEN 1 ELSE 0 END;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = '00000000-0000-4000-8000-0000000000c3'
      AND description = 'fictional migration fixture'
  ) THEN
    RAISE EXCEPTION 'profile data was not preserved';
  END IF;
END $$;
ROLLBACK;
