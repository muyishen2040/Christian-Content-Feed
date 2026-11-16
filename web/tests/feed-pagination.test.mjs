import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFeedPage, feedEventFor } from "../lib/feed-pagination.ts";
import { mockStories } from "../lib/mock-data.ts";

const asItem = (story, rank) => ({ ...story, rank });
const batchId = "00000000-0000-4000-8000-000000000222";
const nextBatchId = "00000000-0000-4000-8000-000000000223";
const response = (items, batch = batchId) => ({
  items,
  nextCursor: null,
  batchId: batch,
  feedVariant: "baseline",
  safetyState: "normal",
  mock: true,
});

test("appending cursor pages retains ordering and original serving batches", () => {
  const first = mergeFeedPage([], response([asItem(mockStories[0], 1), asItem(mockStories[1], 2)]));
  const second = mergeFeedPage(first, response([asItem(mockStories[1], 2), asItem(mockStories[2], 3)], nextBatchId));
  assert.deepEqual(second.map((entry) => entry.story.id), [
    mockStories[0].id, mockStories[1].id, mockStories[2].id,
  ]);
  assert.equal(second[1].batchId, batchId);
  assert.equal(second[2].batchId, nextBatchId);
  assert.equal(second[2].story.rank, 3);
});

test("impression and source-open event use the actual served rank and batch", () => {
  const entry = mergeFeedPage([], response([asItem(mockStories[0], 8)]))[0];
  const event = feedEventFor(
    entry,
    "00000000-0000-4000-8000-000000000224",
    "impression",
    "00000000-0000-4000-8000-000000000225",
  );
  assert.equal(event.rank, 8);
  assert.equal(event.batchId, batchId);
  assert.equal(event.feedVariant, "baseline");
  assert.equal(event.eventName, "impression");
  assert.equal(event.testimonyId, mockStories[0].id);
});
