# Hosted staging database (MUY-46)

A separate Supabase project used for integration tests and for previews. It is **not** the pilot
database. Production is a separate ticket and a separate project.

## Current target

| | |
|---|---|
| Project | `christian-content-feed-staging` (Supabase organization "Shen's") |
| Project ref | `ejvymlkjxcupnkxtzdtv` (not a secret) |
| Region / Postgres | `us-east-1` / 17 |
| Plan and cost | Free plan, quoted $0/month. Do not enable a paid plan without Samuel's approval. Free projects pause after a week of inactivity; unpause from the dashboard, data is kept. |
| Owner of the Supabase org | Samuel (`muyishen2040`). Mu An is invited. |

Check the free-plan limits (database size, projects per organization) before adding data or a second project.

## Tool

`supabase/scripts/staging_db.py` talks to the Supabase Management API over HTTPS, standard library only.
`migrate` and `seed-synthetic` write only with `--apply`; `verify` rolls back its test writes.
`verify-live` creates an anonymous staging user on every run and does not remove it.

```sh
export SUPABASE_ACCESS_TOKEN=...      # short-lived personal access token; never in chat, Linear or git
export PRODUCTION_PROJECT_REFS=...    # optional: comma-separated refs the tool must refuse
REF=ejvymlkjxcupnkxtzdtv; NAME=christian-content-feed-staging

python3 supabase/scripts/staging_db.py migrate --project-ref $REF                        # dry run
python3 supabase/scripts/staging_db.py migrate --project-ref $REF --apply --confirm-name $NAME
python3 supabase/scripts/staging_db.py verify --project-ref $REF --confirm-name $NAME
python3 supabase/scripts/staging_db.py seed-synthetic --project-ref $REF --apply --confirm-name $NAME
python3 supabase/scripts/staging_db.py verify-live --project-ref $REF --anon-key <public publishable key>
```

All commands check the project name and optional production ref blocklist. Migration, seed and SQL verification
also require the exact `--confirm-name`. There is no reset, drop or truncate command. The access token is read
from the environment and never printed. Supply the public key for `verify-live`; it does not fetch API keys.

What each command does:

- `migrate` applies unapplied files from `supabase/migrations` in order and records each in
  `supabase_migrations.schema_migrations` (the same table the Supabase CLI uses, so the CLI sees them too).
  A rerun applies nothing.
- `verify` runs `supabase/tests/rls.sql` (two-user isolation, approved-only metadata, revoked sources, service
  role) and a plain-SQL version of the plaintext-migration guard. Each runs in one request that always ends in an
  error marker, so it cannot commit; afterwards the tool checks that no test users were left behind. It inserts
  fictional rows inside that transaction, which is why it needs `--confirm-name`. The checks look only at their
  own fixture ids, so the seed rows do not affect them.
- `seed-synthetic` loads `supabase/seed/staging_synthetic.sql`: 2 fictional approved stories and 1 hidden draft,
  all on `example.invalid`. Safe to rerun.
- `verify-live` signs in anonymously and reads the REST API. It checks both approved fixture IDs are visible,
  the draft fixture ID is hidden in the view and table, private columns are inaccessible, and no existing user rows are visible. An
  empty result alone does not prove cross-user isolation when no other user's data exists; `verify` tests that.

## What was and was not verified

Verified (2026-11-23) on a local `supabase/postgres:17` container with the tool's own SQL: migrate, rerun
applies nothing, seed twice, `verify` passes with the seed present and leaves no rows; granting `anon` read of
`testimonies.body` makes `verify` fail. The unit tests (`pipeline/tests/test_staging_db.py`) cover the guards.

Verified on the hosted staging project (2026-11-23, run by Mu An with a project-scoped token): `migrate --apply`
applied all 3 migrations, `verify` passed all three checks and left no rows behind (so the Management API does run
one request as one transaction), and `seed-synthetic --apply` loaded the fictional seed. Anonymous sign-ins were enabled in the dashboard
(Authentication > Sign In / Providers) on the same day. `verify-live` takes the project's PUBLIC publishable key
(`sb_publishable_...`, Project Settings > API Keys) with `--anon-key` or `SUPABASE_ANON_KEY`; it refuses a secret-looking key.
Supabase recommends adding a CAPTCHA before anonymous sign-ins go to real users (production, not staging).

macOS note: the python.org Python has no CA bundle, so HTTPS fails with `URLError`. Prefix commands with
`SSL_CERT_FILE=/etc/ssl/cert.pem`, or run "Install Certificates.command" once. Never disable certificate checks.

## Access token

Create it at Supabase > Account > Access Tokens, scoped to **Project**, organization "Shen's", only
`christian-content-feed-staging`, expiry 7 days, with exactly two permissions: **Project Settings: Read** and
**Database: Read-write**. Everything else stays None. Set it only in your own terminal
(`export SUPABASE_ACCESS_TOKEN=...`), never in chat, Linear or git, and delete the token when finished.

## Environment separation

| Variable | Local | Preview (staging) | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | local | staging project only | production project only |
| `PROFILE_DESCRIPTION_KEY` | throwaway | **its own** random 32-byte base64 key | **its own** key, backed up separately |

Do not reuse keys across environments. A privileged Supabase key is not needed by the current mock app or the
Preview check below. Add one only when server-side integration requires it and its key format is verified.
Supabase recommends `sb_secret_...` keys for new server-side integrations; keep them out of clients and chat.

### Verify a Preview connection

The feed still uses mock data. To test the deployed runtime without a privileged key:

1. Set `ENABLE_STAGING_CHECK=true` in Vercel for **Preview**, scoped to the test branch only, then redeploy it.
2. Open `https://<preview-host>/api/staging-check`. `{"ok":true}` means the runtime read the two approved
   fictional fixtures and did not see the draft through the public API. A 503 means configuration is missing or
   not the expected staging project; a 502 means the request or fixture check failed.
3. Remove the branch-specific flag and redeploy when finished. The endpoint returns 404 unless explicitly enabled
   on Preview, and refuses all other Supabase project URLs. A ready page or a standalone `verify-live` is not
   proof that the Vercel runtime uses staging.

This check is public when enabled, returns no story content or credentials, and is not a replacement for the
authenticated `verify-live` or SQL isolation checks. It is pinned to the project ref and fixture IDs in this guide.

## Seeding real testimonies

Do not seed real records until a person has recorded rights approval for the exact storage, display and embedding
use (MUY-43). Then load them through the reviewed loader (`pipeline/loader.py`, draft-only), approve each record
by hand, and record provenance (source, URL, who approved, when). Unknown or unapproved content stays unpublished.
Never copy real user profiles, personal descriptions or production user data into staging.

## Recovery

- Wrong migration applied: do not reset. Write a new forward migration, test it locally, apply it with `migrate`.
- Project paused or unreachable: unpause in the dashboard, then run `status` against the project.
- Staging data is disposable. If it must be rebuilt, create a new staging project, rerun `migrate --apply`,
  `seed-synthetic --apply`, `verify`, `verify-live`, update the ref above and the Vercel Preview variables.
- Lost `PROFILE_DESCRIPTION_KEY` (staging): stored descriptions are unrecoverable; delete the ciphertext rows.

## To finish MUY-46 (needs a person)

1. Done: hosted migration, synthetic seed, SQL verification, anonymous sign-ins and `verify-live` were run.
2. Check a new Vercel Preview reads staging with the steps above.
3. Real seed: blocked on MUY-43.
