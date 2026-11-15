-- MUY-12: Supabase foundation. This migration is deliberately repeatable.
-- Apply only in local/staging first; do not run db reset against a linked production project.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  homepage_url text,
  rights_status text NOT NULL DEFAULT 'pending'
    CHECK (rights_status IN ('pending','approved','rejected','revoked')),
  rights_evidence_url text,
  private_import_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.testimonies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.sources(id) ON DELETE RESTRICT,
  external_id text,
  content_hash text NOT NULL CHECK (length(content_hash) > 0),
  content_type text NOT NULL DEFAULT 'testimony' CHECK (content_type IN ('testimony')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  excerpt text NOT NULL CHECK (length(trim(excerpt)) > 0),
  body text,
  source_name text NOT NULL CHECK (length(trim(source_name)) > 0),
  source_url text,
  topics text[] NOT NULL DEFAULT '{}',
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected')),
  rights_status text NOT NULL DEFAULT 'pending'
    CHECK (rights_status IN ('pending','approved','rejected','revoked')),
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','published','unpublished')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT testimonies_hash_unique UNIQUE (content_hash),
  CONSTRAINT published_requires_approval CHECK (
    publication_status <> 'published' OR
    (review_status = 'approved' AND rights_status = 'approved' AND published_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS testimonies_source_external_unique
  ON public.testimonies (source_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS testimonies_public_feed_idx
  ON public.testimonies (published_at DESC, id)
  WHERE publication_status = 'published'
    AND review_status = 'approved' AND rights_status = 'approved';
CREATE INDEX IF NOT EXISTS testimonies_topics_idx ON public.testimonies USING gin (topics);

CREATE TABLE IF NOT EXISTS public.testimony_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  testimony_id uuid NOT NULL REFERENCES public.testimonies(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  model_version text NOT NULL,
  embedding_dim int NOT NULL CHECK (embedding_dim BETWEEN 1 AND 16000),
  embedding extensions.vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT embeddings_valid_dimension CHECK (extensions.vector_dims(embedding) = embedding_dim),
  CONSTRAINT embeddings_unique_version UNIQUE (testimony_id, model_name, model_version)
);
CREATE INDEX IF NOT EXISTS embeddings_model_idx
  ON public.testimony_embeddings (model_name, model_version, embedding_dim);
-- Do not create a fixed-dimension HNSW/IVFFlat index before MUY-21 selects a model.

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  description text CHECK (description IS NULL OR length(description) <= 2000),
  topics text[] NOT NULL DEFAULT '{}' CHECK (cardinality(topics) <= 12),
  consent_to_personalization boolean NOT NULL DEFAULT false,
  preference_embedding extensions.vector,
  preference_model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  testimony_id uuid NOT NULL REFERENCES public.testimonies(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('interested','not_for_me','save','unsave','undo')),
  request_id uuid NOT NULL,
  undo_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_idempotency UNIQUE (user_id, request_id),
  CONSTRAINT feedback_undo_shape CHECK (
    (action = 'undo' AND undo_event_id IS NOT NULL) OR
    (action <> 'undo' AND undo_event_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS feedback_user_recent_idx ON public.feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_user_story_idx ON public.feedback (user_id, testimony_id, created_at DESC);

-- Fast Saved listing, maintained transactionally by MUY-29; no direct public access.
CREATE TABLE IF NOT EXISTS public.saved_testimonies (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  testimony_id uuid NOT NULL REFERENCES public.testimonies(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, testimony_id)
);
CREATE INDEX IF NOT EXISTS saved_user_recent_idx ON public.saved_testimonies (user_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS public.feed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  testimony_id uuid NOT NULL REFERENCES public.testimonies(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN ('impression','open','click')),
  page_view_id uuid NOT NULL,
  position int CHECK (position IS NULL OR position >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feed_events_user_recent_idx ON public.feed_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_events_story_idx ON public.feed_events (testimony_id, created_at DESC);

-- Source metadata is never selectable by a public or anonymous client.
-- This narrow SECURITY DEFINER predicate permits published rows to be checked
-- against their source's approval without granting SELECT on sources.
CREATE OR REPLACE FUNCTION public.is_source_approved(checked_source_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sources s
    WHERE s.id = checked_source_id AND s.rights_status = 'approved'
  );
$$;
REVOKE ALL ON FUNCTION public.is_source_approved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_source_approved(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_testimony_publication()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.publication_status = 'published' THEN
    IF NEW.review_status <> 'approved' OR NEW.rights_status <> 'approved'
       OR NOT public.is_source_approved(NEW.source_id) THEN
      RAISE EXCEPTION 'Cannot publish an unapproved testimony/source';
    END IF;
    IF NEW.published_at IS NULL THEN NEW.published_at := now(); END IF;
  ELSE
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_testimony_publication ON public.testimonies;
CREATE TRIGGER validate_testimony_publication
  BEFORE INSERT OR UPDATE OF source_id, publication_status, review_status, rights_status
  ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.validate_testimony_publication();

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimony_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_testimonies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved published testimonies" ON public.testimonies;
CREATE POLICY "Approved published testimonies"
  ON public.testimonies FOR SELECT TO anon, authenticated
  USING (
    review_status = 'approved' AND rights_status = 'approved'
    AND publication_status = 'published' AND published_at IS NOT NULL
    AND public.is_source_approved(source_id)
  );

-- auth.uid() is populated by a signed-in anonymous Supabase Auth session
-- (JWT role 'authenticated'), never by the bare anon project key.
DROP POLICY IF EXISTS "Owned profiles" ON public.user_profiles;
CREATE POLICY "Owned profiles"
  ON public.user_profiles FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owned feedback" ON public.feedback;
CREATE POLICY "Owned feedback"
  ON public.feedback FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owned saved testimonies" ON public.saved_testimonies;
CREATE POLICY "Owned saved testimonies"
  ON public.saved_testimonies FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owned feed events" ON public.feed_events;
CREATE POLICY "Owned feed events"
  ON public.feed_events FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Explicit grants prevent accidental direct writes to review-only catalog
-- tables even if default Supabase table privileges are permissive.
REVOKE ALL ON public.sources, public.testimonies, public.testimony_embeddings,
  public.user_profiles, public.feedback, public.saved_testimonies,
  public.feed_events FROM anon, authenticated;
GRANT SELECT ON public.testimonies TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles,
  public.feedback, public.saved_testimonies, public.feed_events TO authenticated;
GRANT ALL ON public.sources, public.testimonies, public.testimony_embeddings,
  public.user_profiles, public.feedback, public.saved_testimonies,
  public.feed_events TO service_role;
