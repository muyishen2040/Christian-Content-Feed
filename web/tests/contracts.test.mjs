import assert from "node:assert/strict";
import { test } from "node:test";
import {
  feedEventRequestSchema,
  feedResponseSchema,
  feedbackRequestSchema,
  profileInputSchema,
  storySchema,
} from "../lib/contracts.ts";
import { ApiError } from "../lib/api-error.ts";
import { MockApiClient } from "../lib/mock-api.ts";
import { mockStories } from "../lib/mock-data.ts";
import { createHttpApiClient } from "../lib/api-client.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const storyId = mockStories[1].id;
const profile = (override = {}) => ({
  description: null,
  topics: ["希望"],
  consentStorePreferences: true,
  consentKeepText: false,
  ...override,
});

test("strict profile fields and consent constraints", () => {
  assert.equal(profileInputSchema.safeParse(profile()).success, true);
  assert.equal(
    profileInputSchema.safeParse(profile({ description: "x".repeat(2001) }))
      .success,
    false,
  );
  assert.equal(
    profileInputSchema.safeParse(profile({ topics: Array(13).fill("希望") }))
      .success,
    false,
  );
  assert.equal(
    profileInputSchema.safeParse(
      profile({ consentKeepText: true, consentStorePreferences: false }),
    ).success,
    false,
  );
  assert.equal(
    profileInputSchema.safeParse(profile({ password: "unexpected" })).success,
    false,
  );
  assert.equal(
    profileInputSchema.safeParse(
      profile({ ageRange: "25-34", gender: "prefer_not_to_say" }),
    ).success,
    true,
  );
});

test("UUIDs, public attribution and editorial summary are required", () => {
  const published = {
    ...mockStories[0],
    isMock: false,
    sourceUrl: "https://publisher.example/story",
  };
  assert.ok(storySchema.safeParse(published).success);
  assert.equal(
    storySchema.safeParse({ ...published, sourceUrl: null }).success,
    false,
  );
  assert.equal(
    storySchema.safeParse({ ...published, id: "mock-story" }).success,
    false,
  );
  assert.equal(
    storySchema.safeParse({ ...published, excerpt: "old field" }).success,
    false,
  );
});

test("publisher links accept only HTTP and HTTPS URLs", () => {
  const published = { ...mockStories[0], isMock: false };
  for (const sourceUrl of [
    "https://publisher.example/story",
    "http://publisher.example/story",
  ]) {
    assert.equal(
      storySchema.safeParse({ ...published, sourceUrl }).success,
      true,
    );
  }
  for (const sourceUrl of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/story",
  ]) {
    assert.equal(
      storySchema.safeParse({ ...published, sourceUrl }).success,
      false,
    );
  }
});

test("opaque feed cursor paginates with UUIDs and stable 1-based ranks", async () => {
  const mock = new MockApiClient();
  const one = await mock.getFeed({ limit: 2 });
  assert.equal(one.items.length, 2);
  assert.equal(one.items[0].rank, 1);
  assert.equal(one.feedVariant, "baseline");
  assert.equal(one.items[0].sourceUrl, null);
  assert.equal(one.items[0].isMock, true);
  assert.ok(one.nextCursor);
  assert.equal(one.nextCursor?.includes(one.items.at(-1).id), false);
  assert.equal(feedResponseSchema.safeParse(one).success, true);
  const two = await mock.getFeed({ limit: 2, cursor: one.nextCursor });
  assert.equal(two.items[0].rank, 3);
  assert.notEqual(one.items[0].id, two.items[0].id);
  assert.notEqual(one.batchId, two.batchId);
  assert.equal(feedResponseSchema.safeParse(two).success, true);
});

test("invalid, mismatched and out-of-range cursors are rejected as 400", async () => {
  const mock = new MockApiClient();
  for (const cursor of [
    "bad-cursor",
    btoa('{"v":1,"offset":999,"scope":"feed","variant":"baseline"}'),
  ]) {
    await assert.rejects(
      () => mock.getFeed({ cursor }),
      (error) => error instanceof ApiError && error.status === 400,
    );
  }
  const saved = await mock.getSaved({ limit: 1 });
  assert.equal(saved.nextCursor, null);
  const feed = await mock.getFeed({ limit: 1 });
  await mock.saveProfile(profile());
  await assert.rejects(
    () => mock.getFeed({ cursor: feed.nextCursor }),
    (error) => error instanceof ApiError && error.status === 400,
  );
});

test("optional description is not retained unless explicitly consented", async () => {
  const mock = new MockApiClient();
  const response = await mock.saveProfile(
    profile({
      description: "這是一段測試文字",
      ageRange: "25-34",
      gender: "prefer_not_to_say",
    }),
  );
  assert.equal(response.safetyState, "normal");
  assert.equal(response.feedMode, "personalized");
  assert.equal(response.profile.description, null);
  const saved = await mock.getProfile();
  assert.equal(saved.profile.description, null);
  assert.equal(saved.profile.ageRange, undefined);
  const noConsent = await mock.saveProfile(
    profile({
      description: "不要保留",
      consentStorePreferences: false,
    }),
  );
  assert.equal(noConsent.profile.description, null);
  assert.equal((await mock.getProfile()).profile, null);
});

test("support flow drops all text and previous personalization", async () => {
  const mock = new MockApiClient({
    detectSupport: (text) => text.includes("fixture-support"),
  });
  await mock.saveProfile(
    profile({ description: "safe", consentKeepText: true }),
  );
  const flagged = await mock.saveProfile(
    profile({
      description: "fixture-support",
      consentKeepText: true,
    }),
  );
  assert.equal(flagged.safetyState, "support");
  assert.equal(flagged.feedMode, "support");
  assert.equal(flagged.profile, null);
  assert.equal((await mock.getProfile()).profile, null);
  assert.equal((await mock.getFeed()).feedVariant, "baseline");
});

test("feedback request validation rejects invalid undo and extra keys", () => {
  assert.equal(
    feedbackRequestSchema.safeParse({
      testimonyId: storyId,
      action: "undo",
      requestId: id(2),
    }).success,
    false,
  );
  assert.equal(
    feedbackRequestSchema.safeParse({
      testimonyId: storyId,
      action: "save",
      requestId: id(3),
      hidden: true,
    }).success,
    false,
  );
  assert.equal(
    feedbackRequestSchema.safeParse({
      testimonyId: storyId,
      action: "save",
      requestId: id(3),
      undoEventId: id(4),
    }).success,
    false,
  );
});

test("feedback is idempotent and conflicting request ID gives HTTP 409", async () => {
  const mock = new MockApiClient();
  const input = { testimonyId: storyId, action: "save", requestId: id(4) };
  const first = await mock.sendFeedback(input);
  assert.deepEqual(await mock.sendFeedback(input), first);
  assert.notEqual(first.eventId, input.requestId);
  assert.equal((await mock.getSaved()).items.length, 1);
  await assert.rejects(
    () => mock.sendFeedback({ ...input, action: "not_for_me" }),
    (error) => error instanceof ApiError && error.status === 409,
  );
  const undo = await mock.sendFeedback({
    testimonyId: storyId,
    action: "undo",
    requestId: id(5),
    undoEventId: first.eventId,
  });
  assert.equal(undo.saved, false);
  assert.equal((await mock.getSaved()).items.length, 0);
});

test("unknown testimony produces 404, stale undo produces 409", async () => {
  const mock = new MockApiClient();
  await assert.rejects(
    () =>
      mock.sendFeedback({
        testimonyId: id(999),
        action: "save",
        requestId: id(1),
      }),
    (error) => error instanceof ApiError && error.status === 404,
  );
  const a = await mock.sendFeedback({
    testimonyId: storyId,
    action: "save",
    requestId: id(2),
  });
  await mock.sendFeedback({
    testimonyId: storyId,
    action: "unsave",
    requestId: id(3),
  });
  await assert.rejects(
    () =>
      mock.sendFeedback({
        testimonyId: storyId,
        action: "undo",
        requestId: id(4),
        undoEventId: a.eventId,
      }),
    (error) => error instanceof ApiError && error.status === 409,
  );
});

test("feed event validates batch, rank, variant and idempotency", async () => {
  const mock = new MockApiClient();
  const feed = await mock.getFeed({ limit: 2 });
  const input = {
    eventId: id(43),
    testimonyId: feed.items[0].id,
    pageViewId: id(44),
    batchId: feed.batchId,
    rank: feed.items[0].rank,
    feedVariant: feed.feedVariant,
    eventName: "impression",
  };
  assert.equal(feedEventRequestSchema.safeParse(input).success, true);
  const first = await mock.recordFeedEvent(input);
  assert.deepEqual(await mock.recordFeedEvent(input), first);
  await assert.rejects(
    () => mock.recordFeedEvent({ ...input, eventName: "open" }),
    (error) => error instanceof ApiError && error.status === 409,
  );
  await assert.rejects(
    () => mock.recordFeedEvent({ ...input, eventId: id(45), rank: 99 }),
    (error) => error instanceof ApiError && error.status === 400,
  );
});

test("reset and delete clear saved stories and retained profiles", async () => {
  const mock = new MockApiClient();
  await mock.saveProfile(
    profile({ description: "opted in", consentKeepText: true }),
  );
  await mock.sendFeedback({
    testimonyId: storyId,
    action: "save",
    requestId: id(2),
  });
  assert.deepEqual(await mock.reset(), { ok: true });
  assert.equal((await mock.getSaved()).items.length, 0);
  assert.equal((await mock.getProfile()).profile, null);
  await mock.saveProfile(profile());
  assert.deepEqual(await mock.deleteProfile(), { ok: true });
  assert.equal((await mock.getProfile()).profile, null);
});

test("HTTP adapter uses typed route contracts and reports typed errors", async () => {
  const mock = new MockApiClient();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const path = String(url);
    const query = new URL("https://example.test" + path).searchParams;
    if (path.startsWith("/api/feed?")) {
      return Response.json(
        await mock.getFeed({
          limit: Number(query.get("limit")),
          cursor: query.get("cursor") ?? undefined,
        }),
      );
    }
    if (path === "/api/profile" && options.method === "PUT") {
      return Response.json(await mock.saveProfile(JSON.parse(options.body)));
    }
    if (path === "/api/profile" && options.method === undefined) {
      return Response.json(await mock.getProfile());
    }
    if (path === "/api/feed/events" && options.method === "POST") {
      return Response.json(
        await mock.recordFeedEvent(JSON.parse(options.body)),
      );
    }
    return Response.json({ message: "invalid" }, { status: 404 });
  };
  const api = createHttpApiClient(fetcher);
  assert.equal((await api.getProfile()).profile, null);
  assert.equal((await api.saveProfile(profile())).safetyState, "normal");
  const feed = await api.getFeed({ limit: 2 });
  assert.equal(feed.items.length, 2);
  assert.equal(calls.at(-1).url, "/api/feed?limit=2");
  assert.equal(calls.at(-1).options.credentials, "same-origin");
  const event = await api.recordFeedEvent({
    eventId: id(200),
    testimonyId: feed.items[0].id,
    rank: 1,
    feedVariant: feed.feedVariant,
    batchId: feed.batchId,
    pageViewId: id(201),
    eventName: "impression",
  });
  assert.equal(event.accepted, true);
  await assert.rejects(
    () => api.getSaved(),
    (error) => error instanceof ApiError && error.status === 404,
  );
});
