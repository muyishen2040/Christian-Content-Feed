# Supabase schema and security (MUY-12)

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
| `saved_testimonies` | own Saved set only; future MUY-29 backend updates transactionally |
| `feed_events` | own impressions/events only |

Supabase Auth anonymous sessions have a **signed-in `authenticated` JWT role** with `auth.uid()`. A bare Supabase `anon` project key has no owner ID and cannot read private profiles, feedback, Saved, or events. Never expose the service-role key to frontend or previews.

Testimony attribution is denormalized into `source_name` and `source_url` so clients never need to SELECT the private `sources` table. A source approval predicate (SECURITY DEFINER, fixed search path) prevents reads after source rights are revoked; a trigger refuses unapproved publications. Publish only after human source-rights and editorial review. Content is not made public by the importer.

The embedding column is variable-dimension `extensions.vector`, validated by `embedding_dim`. **Do not hardcode a vector index dimension until MUY-21 chooses the embedding model.** B-tree indexes cover model/version and feed ordering; create an appropriate dimension-specific pgvector ANN index as part of MUY-23.

## Reproducibility and protections

All schema objects, constraints, grants, RLS policies and indexes are versioned in the migration. DDL uses `IF NOT EXISTS` or drop/recreate policy/trigger to allow a deliberate local rerun; production migration history applies each file once. Automated integration SQL proves two synthetic users cannot read/write across identities and unauthenticated clients cannot read draft content or source metadata. Source rights and user descriptions must not appear in public fixtures/logs.

**Not yet validated by this PR without a configured Supabase local/staging instance:** actual clean `supabase db reset`, live anonymous JWT tests, and review of query plans. These are required before marking MUY-12 Done.
