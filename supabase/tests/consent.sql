-- MUY-26 consent rules. Same shape as rls.sql: one transaction, synthetic users, rolled back at the end.
-- Run through psql, or through staging_db.py verify (which neutralises the BEGIN/ROLLBACK).
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
VALUES
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
 ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
 ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
 ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

-- 1. Without consent the table refuses durable preference state and retained text.
DO $$
BEGIN
 BEGIN
   INSERT INTO public.user_profiles (user_id, topics) VALUES ('00000000-0000-4000-8000-0000000000d1', ARRAY['x']);
   RAISE EXCEPTION 'topics stored without consent';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   INSERT INTO public.user_profiles (user_id, preference_embedding, preference_model_version)
   VALUES ('00000000-0000-4000-8000-0000000000d1', '[1,2,3]'::extensions.vector, 'v1');
   RAISE EXCEPTION 'preference vector stored without consent';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   INSERT INTO public.user_profiles (user_id, description_ciphertext)
   VALUES ('00000000-0000-4000-8000-0000000000d1', decode('0102', 'hex'));
   RAISE EXCEPTION 'retained text stored without consent';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   INSERT INTO public.user_profiles (user_id, consent_keep_text)
   VALUES ('00000000-0000-4000-8000-0000000000d1', true);
   RAISE EXCEPTION 'keep-text consent accepted without preference consent';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- A consent-less row with nothing stored is allowed (a visitor who has not opted in).
 INSERT INTO public.user_profiles (user_id) VALUES ('00000000-0000-4000-8000-0000000000d1');
END $$;

-- 2. With preference consent only: preferences yes, retained text still no.
DO $$
BEGIN
 INSERT INTO public.user_profiles (user_id, consent_to_personalization, topics, preference_embedding, preference_model_version)
 VALUES ('00000000-0000-4000-8000-0000000000d2', true, ARRAY['hope'], '[1,2,3]'::extensions.vector, 'v1');
 BEGIN
   UPDATE public.user_profiles SET description_ciphertext = decode('0102', 'hex')
   WHERE user_id = '00000000-0000-4000-8000-0000000000d2';
   RAISE EXCEPTION 'retained text stored without keep-text consent';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 3. With both consents the retained text is allowed; withdrawing consent requires clearing it.
DO $$
BEGIN
 INSERT INTO public.user_profiles (user_id, consent_to_personalization, consent_keep_text, description_ciphertext)
 VALUES ('00000000-0000-4000-8000-0000000000d3', true, true, decode('0102', 'hex'));
 BEGIN
   UPDATE public.user_profiles SET consent_keep_text = false WHERE user_id = '00000000-0000-4000-8000-0000000000d3';
   RAISE EXCEPTION 'consent withdrawn while text was still stored';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE public.user_profiles SET consent_to_personalization = false, consent_keep_text = false
   WHERE user_id = '00000000-0000-4000-8000-0000000000d3';
   RAISE EXCEPTION 'preference consent withdrawn while text was still stored';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- The clearing patch the API sends (see web/lib/consent.ts) is accepted.
 UPDATE public.user_profiles SET consent_to_personalization = false, consent_keep_text = false,
   topics = '{}', preference_embedding = NULL, preference_model_version = NULL, description_ciphertext = NULL
 WHERE user_id = '00000000-0000-4000-8000-0000000000d3';
END $$;

-- 4. A visitor can read their own consent flags but cannot write them or read others' rows.
INSERT INTO public.user_profiles (user_id, consent_to_personalization)
VALUES ('00000000-0000-4000-8000-0000000000d4', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d4', true);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.user_profiles) <> 1 THEN RAISE EXCEPTION 'visitor sees other profiles'; END IF;
 IF NOT (SELECT consent_to_personalization AND NOT consent_keep_text FROM public.user_profiles) THEN
   RAISE EXCEPTION 'visitor cannot read own consent flags'; END IF;
 BEGIN
   UPDATE public.user_profiles SET consent_keep_text = true;
   RAISE EXCEPTION 'visitor wrote consent directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   UPDATE public.user_profiles SET consent_to_personalization = false;
   RAISE EXCEPTION 'visitor wrote consent directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM description_ciphertext FROM public.user_profiles;
   RAISE EXCEPTION 'visitor read the ciphertext';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
