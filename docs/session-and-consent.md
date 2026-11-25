# Anonymous sessions and consent (MUY-26)

A visitor can read public, approved stories without any account or session. A session exists only after the
visitor does something that needs one (opting in to remember preferences, saving a story). There is no signup page,
email or password.

## How the session works

- `GET /api/session` reports `{ "hasSession": boolean }`. It never creates a session, so ordinary visitors and bots
  reading public pages create no Auth users.
- `POST /api/session` creates a Supabase **anonymous** Auth session. It is idempotent: a browser that already has a
  session gets `200`, a new one gets `201`. The response never contains a user id.
- The session lives in **HttpOnly, SameSite=Lax, Secure (in production)** cookies set by `@supabase/ssr`. Browser
  script cannot read it. `web/proxy.ts` refreshes an expiring token on `/api` requests, and only when the browser
  already has Supabase cookies.
- Every API checks the visitor with `auth.getUser()` (verified with the Auth server), never by trusting the cookie.
  The user id used for any write comes from that verified session and never from the request body.
- Cookie-authenticated mutations (`POST`, `PUT`, `DELETE`) must be same-origin: the `Origin` header must equal the
  site's origin, or, if absent, `Sec-Fetch-Site` must be `same-origin`. Anything else gets `403`.
  This is not the only defence: SameSite cookies, no CORS headers, and RLS apply as well.
- Profile and consent rows are written **only by the server** with the service-role key (visitors have no write
  access to `user_profiles`), after the session is verified. That key is server-only and never sent to the browser.

## Consent

Two separate flags, both default `false`:

| API field | Column | Meaning |
|---|---|---|
| `consentStorePreferences` | `user_profiles.consent_to_personalization` | may keep topics and the preference vector |
| `consentKeepText` | `user_profiles.consent_keep_text` | may also keep the original description (encrypted) |

`consentKeepText` is valid only with `consentStorePreferences`. `GET /api/consent` and `PUT /api/consent` read and
set the visitor's own flags (`PUT` body: exactly those two booleans, max 1 KB, unknown keys rejected).

**Enforced in the database, not only the API** (migration `20261124000000_profile_consent_constraints.sql`):
without `consent_to_personalization` the table refuses topics, a preference vector or retained text; without
`consent_keep_text` it refuses retained text; keep-text consent without preference consent is refused. Withdrawing
consent therefore has to clear what it covered, and the API does that (`web/lib/consent.ts`). Raw description text
is never stored in a column that is not ciphertext; the profile API that writes it is described below.

Without consent a visitor can still use the app: preferences exist only for that page session, nothing durable is
written to user tables.

## Profile API (MUY-27)

`GET`, `PUT` and `DELETE /api/profile` (`web/lib/profile-api.ts`; real wiring in `web/lib/profile-server.ts`). `PUT` is a
full replacement of `ProfileInput`, so an edit is the same call.

- **Empty is valid.** A null or blank description, no topics, or no consent is a `200` with `feedMode:"default"`,
  never a validation error. Invalid input (over 2000 characters, over 12 topics, unknown keys, bad enums, body over
  16 KB, keep-text without preference consent) is `400` with a generic message that does not quote the input.
- **Consent decides what is kept.** Without `consentStorePreferences` nothing is written except the withdrawal of
  earlier consent (the same clearing as `PUT /api/consent`), the embedding service is not called and no session is
  needed. With it, a session is required (`401` otherwise) and topics and the preference vector are saved.
- **Preference vector.** The description is embedded in memory by our private embedding service (Samuel's
  `embedding-client.ts`, no third-party AI API) and only the vector is stored, with `preference_model_version` =
  `model@revision/export_revision`. Replacing the description replaces the vector; a null description clears it.
  `feedMode` is `personalized` when a vector or topics are stored, else `default`.
- **ML service down or invalid answer.** The save still succeeds with no vector and `feedMode:"default"`. The text is
  not queued, logged or stored for retry; the visitor can resubmit.
- **Retained description (explicit opt-in only).** `profile-crypto.ts` settles the key scheme: AES-256-GCM, a random
  nonce per write, the user id as authenticated data (a copy moved to another row will not decrypt), and a 32-byte
  base64 key in the server-only environment variable `PROFILE_DESCRIPTION_KEY`, never in the database. The text is
  encrypted before any database call. A missing or malformed key fails the request with `503 retention_unavailable`
  before the text goes to the embedding service or the database, and `GET` fails the same way rather than return no
  text. Decryption happens only after the session is verified and only for that user's own row. Withdrawing keep-text
  consent, withdrawing preference consent or `DELETE /api/profile` removes the ciphertext. The key has no rotation or
  versioning yet: rotating it makes existing ciphertext unreadable, so it needs a re-encryption step first.
- **Age range and gender** are accepted by the schema but discarded: no column exists, they are never stored, logged or
  used in scoring.
- **No safety claim.** The API does not screen descriptions for crisis signals (that is post-MVP) and always returns
  `safetyState:"normal"`. Handlers never log; errors from the database, Auth or the encryption module are replaced by
  generic `503` bodies, because they can contain submitted values.
- `DELETE /api/profile` deletes the profile row and keeps the anonymous session. Deleting the Auth user and
  owned feedback and saved items is MUY-34.
- Missing from this ticket: per-visitor rate limiting of `PUT` (it calls the ML service). Configure it before the pilot.

## When the browser identity expires or is cleared

- An anonymous identity is only the cookie. If the visitor clears cookies, uses another browser or device, or the
  refresh token expires or is revoked, the old identity **cannot be recovered**. The visitor is treated as new and
  the next action that needs a session creates a new anonymous user. Do not promise recovery: there is no linked
  account.
- Rows owned by an abandoned identity stay until the delete/reset flow (MUY-34) or a cleanup job removes them.
  Supabase does not delete anonymous users automatically. **Open item:** decide a retention/cleanup rule for
  abandoned anonymous users before the pilot.
- The UI should call `GET /api/session` on load and `POST /api/session` only when an action needs a session.

## Known risk: anonymous sign-up abuse

`POST /api/session` creates a user each time a browser without a session calls it. The same-origin check stops
other websites from doing this in a visitor's browser but not a script that sets its own headers. Supabase applies
per-IP rate limits to anonymous sign-ins, and recommends a CAPTCHA. Turn on CAPTCHA protection (Auth > Bot and Abuse
Protection) before real users, and monitor Auth user counts on the Free plan.

**Do not enable CAPTCHA yet.** `signInAnonymously()` in `web/lib/supabase-server.ts` does not send a CAPTCHA token,
so with CAPTCHA on every new anonymous sign-in would fail. Adding token support (the client widget, passing
`options.captchaToken`, and tests) is follow-up work that must land before CAPTCHA is turned on for the pilot.

## Configuration

Server environment (Preview must point at the staging project, see [staging-database.md](staging-database.md)):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only).
Anonymous sign-ins must be enabled in the Supabase project (Authentication > Sign In / Providers).

## How it is tested

`web/tests/profile-api.test.mjs` covers the profile handlers (limits, consent, vector versioning, opt-in retention,
withdrawal, deletion, missing key, ML outage, log redaction), with a stand-in for the crypto module; the real
encryption is tested by `npm run test:profile-crypto`.

- `web/tests/session-consent.test.mjs`: consent rules, same-origin check, session and consent handlers (fakes, no network).
- `supabase/tests/consent.sql`: the database consent constraints, plus visitors reading their own flags but not
  writing them or reading the ciphertext. Runs in CI (`supabase-rls.yml`) and through `staging_db.py verify`.
- `staging_db.py verify-isolation`: two real anonymous sessions over the public REST API; A writes feedback and a
  saved item, B must not read, change, delete or forge them and cannot write profiles or consent directly.

```sh
export SUPABASE_ACCESS_TOKEN=...   # only for migrate/verify; verify-isolation needs just the public key
REF=ejvymlkjxcupnkxtzdtv; NAME=christian-content-feed-staging; KEY=<public publishable key>
python3 supabase/scripts/staging_db.py migrate --project-ref $REF --apply --confirm-name $NAME
python3 supabase/scripts/staging_db.py verify --project-ref $REF --confirm-name $NAME
python3 supabase/scripts/staging_db.py verify-isolation --project-ref $REF --anon-key $KEY
```

## Not in this ticket

Feedback and Saved persistence (MUY-29), feed (MUY-28) and reset/deletion
(MUY-34) build on this. Until MUY-29 lands, saved stories are not yet written by any route.
