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
It writes nothing unless `--apply` is given (migrate, seed) or the command is `verify` (see below).

```sh
export SUPABASE_ACCESS_TOKEN=...      # short-lived personal access token; never in chat, Linear or git
export PRODUCTION_PROJECT_REFS=...    # optional: comma-separated refs the tool must refuse
REF=ejvymlkjxcupnkxtzdtv; NAME=christian-content-feed-staging

python3 supabase/scripts/staging_db.py migrate --project-ref $REF                        # dry run
python3 supabase/scripts/staging_db.py migrate --project-ref $REF --apply --confirm-name $NAME
python3 supabase/scripts/staging_db.py verify --project-ref $REF --confirm-name $NAME
python3 supabase/scripts/staging_db.py seed-synthetic --project-ref $REF --apply --confirm-name $NAME
python3 supabase/scripts/staging_db.py verify-live --project-ref $REF
```

Guards, all checked before any write: the project's real name must contain `staging`; its ref must not be in
`PRODUCTION_PROJECT_REFS`; `--confirm-name` must equal the project name exactly; the project must be
`ACTIVE_HEALTHY`. There is no reset, drop or truncate command. The token is read from the environment only and
is never printed. Only the public anon key is ever fetched (for `verify-live`).

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
- `verify-live` signs in anonymously with the anon key and reads through the REST API: it must see only the
  approved synthetic stories, no private columns (`body`, `private_import_notes`, `description_ciphertext`) and no
  other user's feedback, Saved items or events. It needs anonymous sign-ins enabled in the project's Auth settings
  (`supabase/config.toml` has them on locally; set the same in the dashboard).

## What was and was not verified

Verified (2026-11-23) on a local `supabase/postgres:17` container with the tool's own SQL: migrate, rerun
applies nothing, seed twice, `verify` passes with the seed present and leaves no rows; granting `anon` read of
`testimonies.body` makes `verify` fail. The unit tests (`pipeline/tests/test_staging_db.py`) cover the guards.

**Not yet run against the hosted project.** That needs a person's token (see "To finish"). In particular the
assumption that the Management API runs one request as one transaction is unproven until the first hosted
`verify`; if it fails oddly, run `supabase/tests/rls.sql` through `psql` against the project's database URL instead.

## Environment separation

| Variable | Local | Preview (staging) | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | local | staging project only | production project only |
| `SUPABASE_SERVICE_ROLE_KEY` | local | staging key, server-side only | production key, server-side only |
| `PROFILE_DESCRIPTION_KEY` | throwaway | **its own** random 32-byte base64 key | **its own** key, backed up separately |

Rules: never reuse a key across environments; never give the Preview environment a production value; keep
privileged keys out of source control, Linear and chat. In Vercel, set each variable for the **Preview** scope only
to the staging value, and confirm Production holds different values.

Check: open a preview, then in the staging dashboard confirm new anonymous users appear there and not in
production; and confirm the Preview environment lists no production ref (`grep` the project URL in Vercel settings).

## Seeding real testimonies

Do not seed real records until a person has recorded rights approval for the exact storage, display and embedding
use (MUY-43). Then load them through the reviewed loader (`pipeline/loader.py`, draft-only), approve each record
by hand, and record provenance (source, URL, who approved, when). Unknown or unapproved content stays unpublished.
Never copy real user profiles, personal descriptions or production user data into staging.

## Recovery

- Wrong migration applied: do not reset. Write a new forward migration, test it locally, apply it with `migrate`.
- Project paused or unreachable: unpause in the dashboard, then `status`-check with a dry-run `migrate`.
- Staging data is disposable. If it must be rebuilt, create a new staging project, rerun `migrate --apply`,
  `seed-synthetic --apply`, `verify`, `verify-live`, update the ref above and the Vercel Preview variables.
- Lost `PROFILE_DESCRIPTION_KEY` (staging): stored descriptions are unrecoverable; delete the ciphertext rows.

## To finish MUY-46 (needs a person)

1. Accept the Supabase organization invitation; create a short-lived access token (Account > Access Tokens).
2. Run `migrate --apply`, `verify`, `seed-synthetic --apply`, enable anonymous sign-ins, run `verify-live`.
3. Set the Vercel Preview variables (table above) and check a preview reads staging.
4. Real seed: blocked on MUY-43.
