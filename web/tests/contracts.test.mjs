import assert from "node:assert/strict";
import { test } from "node:test";
import {
  feedbackRequestSchema, profileInputSchema, feedResponseSchema,
} from "../lib/contracts.ts";
import { MockApiClient } from "../lib/mock-api.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("invalid input fails validation without leaking raw content", () => {
  assert.equal(profileInputSchema.safeParse({
    description: "text", topics: [], consentToPersonalization: true, password: "not-allowed",
  }).success, false);
  assert.equal(feedbackRequestSchema.safeParse({
    testimonyId: "mock-waiting", action: "undo", requestId: id(1),
  }).success, false);
});

test("cursor pagination is stable and includes source attribution", async () => {
  const mock = new MockApiClient();
  const one = await mock.getFeed({ limit: 2 });
  assert.equal(one.items.length, 2);
  assert.equal(one.items[0].isMock, true);
  assert.equal(one.items[0].sourceUrl, null);
  assert.ok(one.nextCursor);
  const two = await mock.getFeed({ limit: 2, cursor: one.nextCursor });
  assert.equal(two.items.length, 2);
  assert.notEqual(one.items[0].id, two.items[0].id);
  assert.ok(feedResponseSchema.safeParse(two).success);
});

test("feedback is idempotent, save and undo update Saved", async () => {
  const mock = new MockApiClient();
  const saved = { testimonyId: "mock-waiting", action: "save", requestId: id(2) };
  const first = await mock.sendFeedback(saved);
  assert.deepEqual(await mock.sendFeedback(saved), first);
  assert.equal((await mock.getSaved()).items.length, 1);
  await mock.sendFeedback({
    testimonyId: saved.testimonyId, action: "undo",
    requestId: id(3), undoEventId: first.eventId,
  });
  assert.equal((await mock.getSaved()).items.length, 0);
});

test("reset clears profile and saved data", async () => {
  const mock = new MockApiClient();
  await mock.saveProfile({ description: null, topics: ["希望"], consentToPersonalization: true });
  await mock.sendFeedback({ testimonyId: "mock-waiting", action: "save", requestId: id(4) });
  await mock.reset();
  assert.equal((await mock.getSaved()).items.length, 0);
  assert.equal((await mock.getSafety()).state, "normal");
});

test("unknown cursor is rejected", async () => {
  await assert.rejects(() => new MockApiClient().getFeed({ cursor: "bad-cursor" }));
});
