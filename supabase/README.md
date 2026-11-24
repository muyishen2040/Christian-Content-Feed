# Supabase schema and security

## Local / staging migration workflow

1. Install the Supabase CLI and Docker (or the supported local stack).
2. From the repository root run `supabase start`, then `supabase db reset` **on local only**.
3. Validate RLS with a disposable local DB:
   `psql -X -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/rls.sql`.
   Tests wrap all synthetic fixtures in a transaction and roll back at the end.
4. Rerun `supabase db reset` to verify a clean migration history. Only replay individual migration SQL in a disposable DB: rerunning the initial migration alone restores broader grants until later migrations are reapplied in order.
5. Hosted staging setup, checks and recovery are in [docs/staging-database.md](../docs/staging-database.md).
6. Use a *separate staging Supabase project* for real staging migration checks. Never run `db reset --linked` or copy staging credentials into previews pointing to real pilot users.

## Schema

| Table | Access boundary |
| --- | --- |
| `sources` | service-role only; contains private crawler notes and rights evidence |
| `testimonies` | approved public metadata only; full bodies remain private |
| `published_testimonies` | approved metadata for public and service-side feed reads |
| `testimony_embeddings` | service-role only, versioned by model/version/dimension |
| `user_profiles` | own metadata read/delete; profile writes are server-only |
| `feedback` | own event records only; `(user_id,request_id)` is idempotent |
| `saved_testimonies` | own saved set only; updates require a transactional backend |
| `feed_events` | own impressions/events only |

`testimonies.body` is a nullable, private text column that can hold original article text. There is no separate database column for processed text yet. A future `processed_body` column could hold the cleaned version without overwriting the original; this needs a schema and pipeline change. Full-text access through the app also needs a separate API.

Supabase Auth anonymous sessions have a **signed-in `authenticated` JWT role** with `auth.uid()`. A bare Supabase `anon` project key has no owner ID and cannot read private profiles, feedback, Saved, or events. Never expose the service-role key to frontend or previews.

Visitors may opt in to retain their original description. The backend must encrypt it
before any database call using the server-only `web/lib/profile-crypto.ts` helper.
The database stores ciphertext; clients cannot read it or write profiles directly.

Set `PROFILE_DESCRIPTION_KEY` to a random 32-byte base64 key in server-side secrets,
using different keys per environment. Never put the key or plaintext in database queries,
logs, or browser code. Authenticate and check ownership before decrypting.

The profile API is not implemented yet. Before enabling text retention, connect the
helper to consent-aware profile writes and authorized reads, and verify end-to-end
logging, access, backup, and key-recovery behavior.

Delete the ciphertext when consent is withdrawn or the profile is deleted. Protect and
back up the key separately: without it, stored descriptions cannot be recovered.
Key rotation requires a coordinated re-encryption process before retiring the old key.

The migration refuses to remove the old plaintext column if it contains any data.
If that happens, stop and plan a private encrypted migration; do not discard the data.

Feed queries should use `published_testimonies`, including when using the service role:
its filter excludes unapproved and revoked content even when RLS is bypassed. The view
exposes metadata only. Full bodies and internal source records stay private.

Attribution uses `source_name` and `source_url`. A source approval predicate prevents
reads after rights are revoked; a trigger refuses unapproved publications. Publish only
after human source-rights and editorial review.

The embedding column is variable-dimension `extensions.vector`, validated by
`embedding_dim`. The selected BGE model produces 512-dimensional vectors. Choose a
dimension-specific pgvector ANN index that matches the stored model and version.

## Reproducibility and protections

Schema objects, constraints, grants, RLS policies, and indexes are versioned in the
migration. The integration SQL tests isolation between synthetic users and access to
unpublished content. Keep source rights and user descriptions out of public fixtures and logs.

Validate a clean `supabase db reset`, live anonymous JWT access, and query plans against
a configured local or staging instance before relying on the schema.
