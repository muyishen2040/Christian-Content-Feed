# MVP API contracts (MUY-13)

These versioned, Zod-validated contracts allow frontend development before the database and private ML service exist. Types live in `web/lib/contracts.ts`; use the same `ApiClient` interface for mock and HTTP transports. All responses are JSON. These endpoints are **planned contracts**, not functioning backend persistence. Only the `GET /api/feed` development mock route is implemented by this ticket.

## Identity and data minimization

- No registration flow. Backend (MUY-26) will create an anonymous Supabase-authenticated session; user-owned endpoints require its valid session. A bare unauthenticated `anon` key does **not** grant ownership of another user's data.
- Never log free-text profile descriptions or secrets. Personalization is opt-in and editable; `description` can be `null` to skip it.
- Mock testimony records are **fictional**, have `isMock: true`, an explicit `sourceName`, and no false publisher URLs. Real feed responses must return only approved/published source-attributed content.
- The frontend must not send profile text to the embedding service directly. The backend implements private inference and crisis handling.

## Routes

| Route | Method | Request | Successful response | Errors / semantics |
| --- | --- | --- | --- | --- |
| `/api/profile` | PUT | `ProfileInput` | `ProfileResponse` | 400 invalid; 401 no anonymous session; replace current user's profile idempotently |
| `/api/profile` | DELETE | none | `{ "ok": true }` | 401; delete owned profile and session data, backend enforces deletion |
| `/api/feed?limit=2&cursor=...` | GET | cursor optional; limit 1–20 | `FeedResponse` | 400 malformed cursor; 401 for personalized feed if no session; stable ID-based cursor; mock returns two+ pages |
| `/api/feedback` | POST | `FeedbackRequest` | `FeedbackResponse` | 400 invalid; 401; 404 unknown/removed story; idempotent by `requestId` per user |
| `/api/saved?limit=2&cursor=...` | GET | same cursor contract | `SavedResponse` | 401; only current anonymous user's saved items |
| `/api/profile/reset` | POST | none | `{ "ok": true }` | 401; reset personalization, feedback and Saved; safe to repeat |
| `/api/safety` | GET | none | `SafetyResponse` | 401 when session is required; never echo private text |

The mock adapter can run without a session, solely for UI tests; the production HTTP adapter is not considered safe until MUY-26 implements session handling.

## Types and examples

`ProfileInput`: `{ "description": null, "topics": ["希望"], "consentToPersonalization": true }`.

`FeedResponse`: `{ "items": [{ "id": "mock-waiting", "contentType": "testimony", "title": "等待中的小小亮光", "excerpt": "示意文字", "sourceName": "虛構範例（非真實見證）", "sourceUrl": null, "topics": [], "publishedAt": "2026-01-02T00:00:00.000Z", "isMock": true }], "nextCursor": "mock-waiting", "safetyState": "normal", "mock": true }`.

`FeedbackRequest`: `{ "testimonyId": "mock-waiting", "action": "save", "requestId": "00000000-0000-4000-8000-000000000002" }`.

`FeedbackResponse`: `{ "eventId": "00000000-0000-4000-8000-000000000002", "testimonyId": "mock-waiting", "reaction": null, "saved": true }`.

Supported feedback actions: `interested`, `not_for_me`, `save`, `unsave`, `undo`. Save is a feedback action (not a separate mutating route). `undo` additionally supplies `undoEventId` and can only undo the latest action for that testimony. Duplicate `requestId` returns the original response, without creating a second action. The backend implements this atomically (MUY-29). Clients should generate a UUID once per logical action and reuse it on retries.

`SafetyResponse`: `{ "state": "normal", "resources": [] }` or `state: "support"` and vetted local help resources. Support should not present generated medical or counseling advice.

## Switching adapters

```ts
import { createApiClient } from "@/lib/api-client";
const api = createApiClient("mock"); // in tests/early UI
// const api = createApiClient("http"); // only after backend auth and endpoints work
const page = await api.getFeed({ limit: 2 });
```

The mock adapter keeps profile and Saved state in memory per instance, never persists personal text, and explicitly marks every story as fictional. The mock HTTP feed route is public only for the development scaffold and MUST be replaced/disabled before real-user pilot. The actual database, real HTTP session adapter, recommendations, and crisis detection are outside MUY-13.
