# Optional onboarding and personalization frontend

## Product and navigation

Christian Content Feed is a Traditional Chinese application for discovering first-person Christian testimonies. **The root URL (`/`) remains the feed**. There is no separate marketing homepage or mandatory sign-up.

The first visit displays a compact, dismissible invitation **inside the feed**, with one primary action to personalize and a clearly labeled **Skip and explore** option. Skipping neither opens nor submits a profile form. The welcome dismissal is the only marker stored in `localStorage`; it is a non-sensitive boolean and is not a personalization signal. The permanent **調整推薦** link in the header allows visitors to open `/personalize` later.

The `/personalize` route accepts an optional free-form personal description, optional age range, and optional gender. Both demographic selectors support **Prefer not to say**. Every field can be blank. **看看我的故事推薦** sends a validated profile using the shared API contract, and **略過，直接探索** returns to the default feed without sending the form.

A separate `/support` route provides general support and a link to the default feed when the profile API returns `feedMode: "support"` or `safetyState: "support"`. It is also directly linked from the form and feed footer. This page is not a country-specific crisis directory; localized resources and an appropriate release review remain necessary.

## API and data flow

The form uses `profileInputSchema` and calls `saveOnboarding` on the existing `FeedSessionProvider`. This provider shares its `ApiClient` instance between onboarding and the feed:

- Blank or skipped visits have a default/curated feed. Skipping does **not** call the profile API.
- A successful `saveProfile` returns `feedMode: personalized | default | support`. The provider resets cached feed pages, rank/batch state, and scroll position on successful profile changes before reloading recommendations. It invalidates in-flight older feed requests to prevent stale results.
- Failed submissions preserve the unsent form for retry or skipping. Error messages do not include user text or raw backend errors.
- The form always sends `consentKeepText: false`. The optional checkbox controls `consentStorePreferences`. The description is never put into localStorage, sessionStorage, analytics events, or client logs by this interface.
- Age and gender remain outside the ranking calculation. The `topics` contract field is sent as an empty list; a separate preference editor can introduce an explicit topic picker later.

### Development mock versus HTTP integration

- `NEXT_PUBLIC_FEED_API_MODE=mock` (default): the existing `MockApiClient` accepts the profile, optionally marks the current in-memory session as personalized, and serves fictional story fixtures. It **does not run a real recommendation or safety detector**, persist any profile across page reloads, or retain the original description. The welcome copy explicitly discloses the demonstration limitations.
- `NEXT_PUBLIC_FEED_API_MODE=http`: the browser uses the typed same-origin `PUT /api/profile` endpoint via the existing API client. It does not silently substitute mock data when the backend fails. Backend identity, consent enforcement, source-text handling, persistent anonymous preferences, safety filtering and storage permissions must be verified before a real deployment.

### Privacy and consent boundaries

The planned backend uses an internally hosted inference model rather than a third-party AI inference API. The frontend accurately communicates that raw text is processed by the service and that retaining anonymous preferences requires an explicit choice. It never requests raw-text retention and does not persist sensitive form fields locally.

The backend must honor `consentStorePreferences`, discard raw text by default, avoid sensitive input logs, and ensure a safety-flagged input cannot influence ranking. **This frontend and its tests do not certify the backend's privacy implementation**. Do not deploy the HTTP mode as production-ready until the identity, privacy and safety API review is complete.

Only a non-sensitive dismissal bit is persisted in the browser to avoid repeating the welcome on every visit. Reset/delete functionality must later clarify whether this convenience marker is also removed; this document does not claim a complete privacy deletion feature.

## UI and accessibility

The view shares the existing paper background, moss accent, Chiron Sung HK display face, Noto Sans TC interface face, input/button tokens, and keyboard focus treatment. The design avoids interstitial sign-up walls, unnecessary illustration, and decorative effects.

The mobile-first form uses explicit labels, native selects with an unselected option, a `maxLength=2000` textarea with live count, a clearly distinguishable unchecked-by-default retention checkbox, disabled loading controls, and a polite retry/error message. At 520px or narrower, all action buttons span the form width. The layout is tested at 320, 375, 768 and 1280px.

## How to test

From `web/`:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

The GitHub workflow `.github/workflows/onboarding-smoke.yml` runs two build variants:

1. **Mock mode:** verifies first-visit invitation, dismiss and reload behavior, skip, all-blank submission, optional inputs, current-session personalization, and absence of raw text in browser storage.
2. **HTTP mode:** intercepts the same-origin profile/feed requests with **synthetic responses**, verifying consent payloads, successful personalized/default routing, safety-support routing, backend failure/retry, and skip without submitting text.

Both variants capture full-page screenshots of `/personalize` at 320, 375, 768 and 1280px and check for horizontal overflow. The existing responsive feed and HTTP feed browser suites continue to cover the feed itself.

## Deferred work

The mock dataset is fictional and does not demonstrate actual ranking quality. Real anonymous identity, persistence, profile API implementation, crisis-support localization, detailed preference editing and reset/deletion, verified private inference, and source-approved testimonies are separate tasks. This PR does not claim that those features exist.
