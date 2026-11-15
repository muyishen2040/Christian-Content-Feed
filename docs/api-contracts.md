# MVP API contracts (MUY-13)

These versioned contracts are intentionally **ahead of backend persistence** so frontend and backend can work in parallel. Types live in `web/lib/contracts.ts`. The `ApiClient` interface is implemented by an in-memory `MockApiClient` and an HTTP adapter.

Only **GET /api/feed** is currently a real (flag-gated) Next.js development route in this PR. All other routes below are *contract specifications*; MUY-26–29 and MUY-34 must implement them before the pilot. Do not call unfinished endpoints from a production UI.

## Privacy / anonymous identity

- A visitor can browse published content without registration. Backend MUY-26 must create a signed-in Supabase **anonymous-auth** session for persistent user-owned preferences/Saved data. The public `anon` key alone has no owner identity.
- `description` is nullable; skip onboarding without an error. `ageRange` and `gender` are optional UI fields and **not used in ranking**. They should not be stored by the backend unless a separate documented, consented requirement exists (no corresponding columns in MUY-12).
- Two separate consents: `consentStorePreferences` authorizes durable preference vectors and saved preferences; `consentKeepText` additionally opts in to keeping the original description, and is valid only when preference storage is consented. **Default: do not persist raw free text.**
- In the mock adapter, `saveProfile` returns a sanitized `profile` (without raw text unless consented), and `getProfile` returns only opt-in retained data. The API response must never echo a flagged description.
- `ProfileResponse` always includes `safetyState: "normal" | "support"` and `feedMode: "default" | "personalized" | "support"`. When safety checks signal support, the backend must drop the submitted description (never log/persist/embed it), return `profile: null` and `feedMode: "support"`; onboarding displays support messaging before a curated feed. Mock tests inject a synthetic `detectSupport` callback only to exercise this state; **no clinical detector is implemented** in MUY-13.
- Raw descriptions must never go to analytics, client error capture, audit logs or third-party inference APIs. ML-05 and BE-02 handle real safety and inference.

## Route contract

| Route | Method | Request | Response | Ownership / errors |
| --- | --- | --- | --- | --- |
| `/api/profile` | GET | none | `ProfileResponse` | MUY-27; 401 if retained profile requires session; no retained profile returns `profile:null` |
| `/api/profile` | PUT | `ProfileInput` | `ProfileResponse` | MUY-27; 400 invalid, 401 no session where needed; support state excludes raw description |
| `/api/profile` | DELETE | none | `{ "ok": true }` | MUY-34; idempotent account-free deletion after anonymous-session authentication |
| `/api/feed?limit=2&cursor=...` | GET | opaque `cursor`, limit 1–20 | `FeedResponse` | MUY-28; 400 invalid, stable ranked pagination and editorial fallback |
| `/api/feed/events` | POST | `FeedEventRequest` | `FeedEventResponse` | MUY-28; 400 invalid/batch mismatch, 401 no session, 409 conflicting retry |
| `/api/feedback` | POST | `FeedbackRequest` | `FeedbackResponse` | MUY-29; 400 invalid, 401, 404 missing story, 409 request-id conflict or stale undo |
| `/api/saved?limit=2&cursor=...` | GET | pagination | `SavedResponse` | MUY-29; 401; only current visitor's Saved |
| `/api/profile/reset` | POST | none | `{ "ok": true }` | MUY-34; 401; clears owned profile preferences, feedback and Saved |
| `/api/safety` | GET | none | `SafetyResponse` | MUY-27/FE-06; vetted support resources; no raw description in response |

All successful responses are JSON. `ApiError` from the HTTP adapter exposes `status` and `code` for UI recovery without reflecting arbitrary server error bodies.

## Stories, ranked feed and measurement

- All story IDs and `testimonyId` values are UUIDs, matching `public.testimonies.id`. Real published stories require `sourceUrl` and `sourceName`. Only fictional `isMock:true` records may have `sourceUrl:null`.
- API field `summary` means **our original, approved editorial summary**, not copied publisher text. MUY-12 currently names the SQL column `testimonies.excerpt`; MUY-28 must map the database value to `summary` or migrate the column (and verify licensing) before serving real stories.
- `FeedResponse` includes `batchId` (UUID), `feedVariant` (`baseline` or `personalized`) and `rank` (1-based on each item) to evaluate first-ten relevance and source opens. `nextCursor` is **opaque**, not a story ID or offset exposed to the client. Clients must only pass it back unchanged.
- The development adapter encodes an opaque, reversible fixture offset. **This is not a production-security mechanism or ranked snapshot**; MUY-23/MUY-28 must produce a stable, authenticated/signed ranking snapshot cursor, preserving ordering when feedback changes.
- `FeedEventRequest`: `{ "eventId": UUID, "testimonyId": UUID, "batchId": UUID, "pageViewId": UUID, "rank": 1, "feedVariant": "baseline", "eventName": "impression" }`. Client sends *impression* only after an agreed viewability threshold, not when the response is fetched; source opens/clicks are distinct. Deduplicate by `(user_id, event_id)` and ensure recorded batch/rank/variant match the served feed.
- **MUY-12 schema follow-up:** current `feed_events` has `position`/`page_view_id` but lacks `batch_id`, `feed_variant` and a dedupe request ID. MUY-28 must add migration fields and/or an event ledger mapping. This PR does not quietly alter a merged migration.

## Idempotent feedback

`FeedbackRequest`:

```json
{
  "testimonyId": "00000000-0000-4000-8000-000000000102",
  "action": "save",
  "requestId": "00000000-0000-4000-8000-000000000002"
}
```

`FeedbackResponse`: `{ "eventId": "feedback-row-uuid", "testimonyId": "<uuid>", "reaction": null, "saved": true }` (eventId is a UUID in actual requests).

- `requestId` is a client-generated UUID for one logical operation, retained across retries. A repeat with **identical** payload returns the original response. A repeat with a **different** payload must fail **409 Conflict** without side effects.
- `FeedbackResponse.eventId` is the server's `public.feedback.id`, **not** `requestId`.
- `undo` supplies `undoEventId` pointing to the previous feedback **row's `id`**. Undo of an old, superseded event fails 409. Undo is itself idempotent by its own `requestId`.
- Save is an independent boolean alongside Interested/Not for me, so saving a story does not silently overwrite the reaction.
- Backend MUY-29 must enforce these guarantees transactionally and use ownership checks; mock memory is not authoritative.

## CSRF, deletion and backend responsibility

- Authenticated mutations (`POST`, `PUT`, `DELETE`) that use cookies must require a valid same-origin `Origin` header (or a carefully specified and tested fallback), verify a synchronizer/double-submit CSRF token when applicable, reject cross-site requests, and use `SameSite=Lax/Strict` and secure, HttpOnly session cookies. CORS configuration must not expose credentialed endpoints to arbitrary origins. **Do not rely on SameSite alone**. Implement and test in MUY-26; this contract PR adds no real mutation handlers.
- Account-free does not mean unauthenticated deletion. Use the visitor's signed-in anonymous session, verify ownership server-side, then invoke the Supabase **Admin Auth API server-side** to delete their `auth.users` row and cascade protected owned data as appropriate. The browser must never receive the service-role key. MUY-34 implements this, including browser-local cleanup, retries and RLS tests.
- MUY-12 follow-ups separate from MUY-13: restrict public access to full testimony bodies via a dedicated reviewed published-content projection; ensure user text cannot be inadvertently logged through failed DB constraints; do not cascade-delete all user feedback on catalog unpublication; include additional rights/audit fields as ingestion requirements solidify. Do not consider these security checks automatically satisfied by this contract PR.

## Mock route opt-in and adapter usage

`GET /api/feed` serves **fictional** records only when:

- `ENABLE_MOCK_FEED=true`, **and**
- process is local development, or the deployment has `VERCEL_ENV=preview`, **and**
- `VERCEL_ENV` is **not** `production`.

A production deployment without an explicit approved preview context responds 404, even if the flag is accidentally set. The route is temporary and must be replaced by MUY-28 for the pilot. Do not enable this flag on a real pilot environment. `MockApiClient` remains available for test-only browser UI state and never stores text in local storage.

```ts
import { createApiClient } from "@/lib/api-client";

const api = createApiClient("mock"); // local UI tests
const first = await api.getFeed({ limit: 2 });
const next = await api.getFeed({ limit: 2, cursor: first.nextCursor ?? undefined });

// Switch to "http" only once MUY-26–29 handlers, session and CSRF checks work.
```

The API adapter tests use a fake `fetch`; contract tests include 2000-character and 12-topic limits, strict unknown-key rejection, support-state omission, UUIDs, idempotency, missing stories, cursor validation and batch event semantics. None of these tests claim a deployed production backend.
