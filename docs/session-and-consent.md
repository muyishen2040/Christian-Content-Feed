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
is never stored in a column that is not ciphertext; the profile API that writes it is MUY-27.

Without consent a visitor can still use the app: preferences exist only for that page session, nothing durable is
written to user tables.

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

Profile onboarding writes (MUY-27), feedback and Saved persistence (MUY-29), feed (MUY-28) and reset/deletion
(MUY-34) build on this. Until MUY-27 and MUY-29 land, only the consent flags persist across a refresh; saved
stories and preference vectors are not yet written by any route.
