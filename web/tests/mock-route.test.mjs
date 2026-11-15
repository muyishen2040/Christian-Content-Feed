import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET,
  handleMockFeedGet,
  mockFeedEnabled,
} from "../lib/mock-feed-route.ts";

test("mock feed fails closed without explicit enablement or in production", async () => {
  assert.equal(mockFeedEnabled({ NODE_ENV: "development" }), false);
  assert.equal(
    mockFeedEnabled({ NODE_ENV: "production", VERCEL_ENV: "production", ENABLE_MOCK_FEED: "true" }),
    false,
  );
  const response = await handleMockFeedGet(
    new Request("https://example.test/api/feed"),
    { NODE_ENV: "production", VERCEL_ENV: "production", ENABLE_MOCK_FEED: "true" },
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Not Found");
  assert.equal(typeof GET, "function");
});

test("mock feed can be enabled on a Vercel preview or in local dev", async () => {
  const preview = { NODE_ENV: "production", VERCEL_ENV: "preview", ENABLE_MOCK_FEED: "true" };
  assert.equal(mockFeedEnabled(preview), true);
  const response = await handleMockFeedGet(
    new Request("https://example.test/api/feed?limit=2"),
    preview,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const feed = await response.json();
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].rank, 1);
  assert.equal(feed.feedVariant, "baseline");
  assert.ok(feed.batchId);
  const second = await handleMockFeedGet(
    new Request(`https://example.test/api/feed?limit=2&cursor=${feed.nextCursor}`),
    preview,
  );
  assert.equal(second.status, 200);
  assert.equal((await second.json()).items[0].rank, 3);
});

test("invalid cursor and page limit are HTTP 400, not 500", async () => {
  const env = { NODE_ENV: "development", ENABLE_MOCK_FEED: "true" };
  for (const url of [
    "https://example.test/api/feed?limit=21",
    "https://example.test/api/feed?limit=banana",
    "https://example.test/api/feed?cursor=not-a-valid-token",
  ]) {
    const response = await handleMockFeedGet(new Request(url), env);
    assert.equal(response.status, 400);
  }
});
