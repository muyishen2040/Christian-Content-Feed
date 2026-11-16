# Functional testimony feed

## Product behavior

Christian Content Feed helps visitors discover Traditional Chinese personal Christian testimonies. The root route (`/`) is the feed itself. A visitor can browse story cards, open a short internal story-detail view, and follow a publisher's original link when one is available and approved for display.

The frontend uses the typed `ApiClient` contract. It currently supports two **explicit** data modes:

- `NEXT_PUBLIC_FEED_API_MODE=mock` (default): the existing in-memory `MockApiClient` serves six **fictional** stories for design and interaction testing. All such records are labeled as demonstrations; they do not have invented publisher URLs. Feedback toggles only affect in-memory presentation.
- `NEXT_PUBLIC_FEED_API_MODE=http`: the frontend calls `GET /api/feed` and `POST /api/feed/events` via the existing typed HTTP adapter, without silently replacing failed backend responses with mock records. Use this only once the real endpoints are available. The repository's existing mock GET endpoint is explicitly gated and is **not** a substitute for a production feed.

The two modes are selected at **build time**. In the browser integration workflow, the HTTP endpoints are **intercepted** with fictional test responses. That does not constitute a deployed production backend or publisher approval.

## Implementation map

| File | Responsibility |
| --- | --- |
| `web/lib/contracts.ts` | Strict schema for feed responses and optional, rights-gated thumbnail metadata |
| `web/lib/api-client.ts` | Existing typed HTTP adapter and mock adapter factory |
| `web/lib/feed-pagination.ts` | Pure deduplication and batch-attributed event construction |
| `web/components/feed-session-provider.tsx` | A root-layout-scoped session holding fetched pages, cursor, state, viewport position and event IDs |
| `web/components/feed-experience.tsx` | Loading, empty, error/retry, curated/default, card rendering and cursor pagination |
| `web/components/story-visibility.tsx` | IntersectionObserver visibility threshold and delay for impressions |
| `web/components/ui/testimony-card.tsx` | Story title, approved summary, source name, content type, permitted image and original-source action |
| `web/components/story-reading-view.tsx` | Fictional detail preview or a real record's approved summary and original-source link |
| `web/tests/feed-pagination.test.mjs` | Cursor merge and rank/batch event tests |
| `web/tests/story-visual.test.mjs` | Approved-image and safe fallback checks |
| `web/scripts/check-functional-feed.mjs` | Browser test of HTTP paging, viewability, error/retry, empty state and detail navigation |

## Loading, pagination and position restoration

The first request uses `getFeed({ limit: 4 })`; subsequent requests pass the returned `nextCursor` unchanged. The session appends unique story IDs in display order, preserving each item's **original serving batch ID, rank and feed variant** for metrics. A repeated/stalled cursor stops further requests rather than creating an infinite loop.

Additional pages load when an IntersectionObserver sees the bottom sentinel, with an explicit **載入更多故事** button for accessibility and manual recovery. Empty data produces a dedicated empty state. Failed requests produce a retry action; previously loaded content remains visible if a later page fails.

The session provider stays mounted across client-side feed ↔ article navigation. It keeps already loaded pages, local demonstration feedback, and the last viewport position in memory, then restores the viewport on return. A single **numeric scroll offset** is temporarily placed in `sessionStorage` during an internal story visit, then cleared on successful restoration. **No personal descriptions, cursor tokens, story text, or browsing history are persisted to localStorage or application servers by this frontend.** A full page reload or direct deep link to an unknown real story may lose in-memory context. Direct-link support requires a separate authenticated, rights-aware single-story API.

## Source content, article view and image rights

The story schema requires `sourceName` and, for any non-fictional record, a `sourceUrl`. The card presents an explicit external publisher link (`target="_blank"`, `rel="noopener noreferrer"`). Fictional records display an honest unavailable-source label, not a broken or invented link.

Real record cards may display a source-provided thumbnail **only if** `thumbnailUrl` is HTTPS and `thumbnailApproved === true`. Missing or unapproved images render a stable text-first gradient card. The existing atmospheric Pexels photos apply **only to clearly fictional mock stories**.

On the detail page, real records show the approved editorial summary and a link to the publisher. They never fabricate a full article or rehost copyrighted body text. The longer paragraphs in the repository are explicitly fictional and displayed only for mock stories.

These flags are not a legal approval process: a future content importer or administrator must record and verify the rights evidence that authorizes display. Access to a public web page alone does not grant redistribution rights.

## Impression and source-open events

For each story card, an `impression` is generated only after **at least 50% of the card remains within the viewport for 1,000 ms continuously while the tab is visible**. Page loading alone emits no impression.

Events match the existing contract: `eventId`, `testimonyId`, `batchId`, `pageViewId`, the originally served `rank`, `feedVariant`, and `eventName` (`impression`, `open`, or `click`). The browser suppresses duplicate impressions within its current feed session. Events are sent best-effort; a missing telemetry endpoint does not block reading. The backend is responsible for validation, ownership, rate limits and idempotent recording.

No raw personal description or sensitive story text is logged by the UI.

## Verification

From `web/`, run:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

The repository's **Mobile design screenshots and smoke** workflow tests the fictional mock appearance and 320, 375, 768 and 1280px layouts. The separate **Functional feed integration** workflow builds the application with `NEXT_PUBLIC_FEED_API_MODE=http`, intercepts fake responses in Playwright, and validates initial loading, cursor requests, duplicate filtering, source links, rights-gated images, event attribution, scroll restoration, and empty/error recovery. No real publisher API is contacted.

## What is not implemented

Recommendation ranking, authenticated preference management, persistent Interested/Saved/Not for me, rights-reviewed production ingestion, a real feed/events backend, direct fetching of unfamiliar story IDs, crisis-detection services, and a complete production security and legal review are separate work. The current client deliberately does not imply those features already exist.
