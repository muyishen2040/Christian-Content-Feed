# Supabase schema and security

## Local / staging migration workflow

1. Install the Supabase CLI and Docker (or the supported local stack).
2. From the repository root run `supabase start`, then `supabase db reset` **on local only**.
3. Validate RLS with a disposable local DB:
   `psql -X -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/rls.sql`.
   Tests wrap all synthetic fixtures in a transaction and roll back at the end.
4. Rerun `supabase db reset` to verify a clean migration history. For extra repeatability checks, run the migration SQL a second time with psql in a disposable DB.
5. Use a *separate staging Supabase project* for real staging migration checks. Never run `db reset --linked` or copy staging credentials into previews pointing to real pilot users.

## Schema

| Table | Access boundary |
| --- | --- |
| `sources` | service-role only; contains private crawler notes and rights evidence |
| `testimonies` | public read only when source, review and rights all approved and status published |
| `testimony_embeddings` | service-role only, versioned by model/version/dimension |
| `user_profiles` | own authenticated anonymous user ID only |
| `feedback` | own event records only; `(user_id,request_id)` is idempotent |
| `saved_testimonies` | own saved set only; updates require a transactional backend |
| `feed_events` | own impressions/events only |

Supabase Auth anonymous sessions have a **signed-in `authenticated` JWT role** with `auth.uid()`. A bare Supabase `anon` project key has no owner ID and cannot read private profiles, feedback, Saved, or events. Never expose the service-role key to frontend or previews.

Testimony attribution is denormalized into `source_name` and `source_url` so clients never need to SELECT the private `sources` table. A source approval predicate (SECURITY DEFINER, fixed search path) prevents reads after source rights are revoked; a trigger refuses unapproved publications. Publish only after human source-rights and editorial review. Content is not made public by the importer.

The embedding column is variable-dimension `extensions.vector`, validated by
`embedding_dim`. The selected BGE model produces 512-dimensional vectors. Choose a
dimension-specific pgvector ANN index that matches the stored model and version.

## Reproducibility and protections

Schema objects, constraints, grants, RLS policies, and indexes are versioned in the
migration. The integration SQL tests isolation between synthetic users and access to
unpublished content. Keep source rights and user descriptions out of public fixtures and logs.

Validate a clean `supabase db reset`, live anonymous JWT access, and query plans against
a configured local or staging instance before relying on the schema.
