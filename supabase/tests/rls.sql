-- Integration tests for MUY-12. Run only against a disposable local Supabase DB.
-- psql -X -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/rls.sql
BEGIN;

DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'user_profiles'
     AND column_name = 'description'
 ) THEN RAISE EXCEPTION 'plaintext profile column must not exist'; END IF;
END $$;

-- Synthetic, disposable auth users. No actual private descriptions or credentials.
INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

INSERT INTO public.sources (id, name, rights_status, private_import_notes)
VALUES
 ('00000000-0000-4000-8000-000000000001', 'Approved fictitious source', 'approved', 'secret crawler notes'),
 ('00000000-0000-4000-8000-000000000002', 'Not reviewed source', 'pending', 'private');

INSERT INTO public.testimonies
 (id, source_id, content_hash, title, excerpt, source_name,
  review_status, rights_status, publication_status)
VALUES
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
  'fixture-approved-11', 'Synthetic approved testimony', 'Fictional example',
  'Approved fictitious source', 'approved', 'approved', 'published'),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001',
  'fixture-pending-12', 'Synthetic pending testimony', 'Do not expose',
  'Approved fictitious source', 'pending', 'pending', 'draft');

INSERT INTO public.user_profiles (user_id, topics, description_ciphertext)
VALUES
 ('00000000-0000-4000-8000-0000000000a1', ARRAY['fixture A'], decode('010203', 'hex')),
 ('00000000-0000-4000-8000-0000000000b2', ARRAY['fixture B'], decode('040506', 'hex'));
INSERT INTO public.feedback (user_id, testimony_id, action, request_id)
VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000011','save','00000000-0000-4000-8000-000000000091'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000011','save','00000000-0000-4000-8000-000000000092');
INSERT INTO public.saved_testimonies (user_id, testimony_id)
VALUES
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-000000000011');
INSERT INTO public.feed_events (user_id, testimony_id, event_name, page_view_id)
VALUES
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000011','impression','00000000-0000-4000-8000-000000000081'),
 ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-000000000011','impression','00000000-0000-4000-8000-000000000082');

SET LOCAL ROLE anon;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.published_testimonies) <> 1
 THEN RAISE EXCEPTION 'anon must only read approved, published source-backed testimony'; END IF;
 BEGIN
   PERFORM body FROM public.testimonies;
   RAISE EXCEPTION 'anon unexpectedly read testimony body';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM content_hash FROM public.testimonies;
   RAISE EXCEPTION 'anon unexpectedly read internal content hash';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM private_import_notes FROM public.sources;
   RAISE EXCEPTION 'anon unexpectedly read private source metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
DO $$
DECLARE n integer;
BEGIN
 IF (SELECT count(*) FROM public.published_testimonies) <> 1
 THEN RAISE EXCEPTION 'authenticated user saw unapproved content'; END IF;
 BEGIN
   PERFORM body FROM public.testimonies;
   RAISE EXCEPTION 'authenticated user unexpectedly read testimony body';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 IF (SELECT count(*) FROM public.user_profiles) <> 1
 THEN RAISE EXCEPTION 'user A read another user profile'; END IF;
 IF (SELECT count(*) FROM public.feedback) <> 1
 THEN RAISE EXCEPTION 'user A read another user feedback'; END IF;
 IF (SELECT count(*) FROM public.saved_testimonies) <> 1
 THEN RAISE EXCEPTION 'user A read another user Saved rows'; END IF;
 IF (SELECT count(*) FROM public.feed_events) <> 1
 THEN RAISE EXCEPTION 'user A read another user feed events'; END IF;

 DELETE FROM public.user_profiles
 WHERE user_id = '00000000-0000-4000-8000-0000000000b2';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'user A deleted user B'; END IF;

 BEGIN
   PERFORM description_ciphertext FROM public.user_profiles;
   RAISE EXCEPTION 'client unexpectedly read encrypted profile text';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   UPDATE public.user_profiles SET topics = ARRAY['should not change']
   WHERE user_id = '00000000-0000-4000-8000-0000000000a1';
   RAISE EXCEPTION 'client unexpectedly wrote directly to profiles';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   INSERT INTO public.user_profiles (user_id)
   VALUES ('00000000-0000-4000-8000-0000000000a1');
   RAISE EXCEPTION 'client unexpectedly inserted directly into profiles';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;

 BEGIN
   INSERT INTO public.feedback (user_id, testimony_id, action, request_id)
   VALUES ('00000000-0000-4000-8000-0000000000b2',
           '00000000-0000-4000-8000-000000000011',
           'save', '00000000-0000-4000-8000-000000000093');
   RAISE EXCEPTION 'user A inserted user B feedback';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.user_profiles) <> 1 OR
    (SELECT count(*) FROM public.feedback) <> 1
 THEN RAISE EXCEPTION 'user B read wrong rows'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.published_testimonies) <> 1
 THEN RAISE EXCEPTION 'service role view must exclude drafts'; END IF;
 IF (SELECT description_ciphertext FROM public.user_profiles
     WHERE user_id = '00000000-0000-4000-8000-0000000000a1') <> decode('010203', 'hex')
 THEN RAISE EXCEPTION 'service role could not read encrypted profile data'; END IF;
 UPDATE public.user_profiles SET description_ciphertext = decode('0a0b0c', 'hex')
 WHERE user_id = '00000000-0000-4000-8000-0000000000a1';
END $$;
RESET ROLE;

UPDATE public.sources SET rights_status = 'revoked'
WHERE id = '00000000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.published_testimonies) <> 0
 THEN RAISE EXCEPTION 'revoked source must not remain public'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.published_testimonies) <> 0
 THEN RAISE EXCEPTION 'service role view must exclude revoked sources'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
