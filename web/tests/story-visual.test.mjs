import assert from "node:assert/strict";
import { test } from "node:test";
import { storyVisual } from "../lib/story-visual.ts";
import { storySchema } from "../lib/contracts.ts";
import { mockStories } from "../lib/mock-data.ts";

const real = {
  ...mockStories[0],
  isMock: false,
  sourceUrl: "https://publisher.example/story",
};

test("fictional fixtures use distinct, clearly illustrative demo backgrounds", () => {
  assert.equal(storyVisual(mockStories[0], 1).className, "story-cover--0");
  assert.equal(storyVisual(mockStories[1], 2).className, "story-cover--1");
});

test("unapproved or missing thumbnails always use a text-first fallback", () => {
  for (const story of [
    real,
    { ...real, thumbnailUrl: "https://images.example/cover.png" },
    {
      ...real,
      thumbnailUrl: "https://images.example/cover.png",
      thumbnailApproved: false,
    },
    {
      ...real,
      thumbnailUrl: "http://images.example/cover.png",
      thumbnailApproved: true,
    },
  ]) {
    assert.equal(storyVisual(story, 1).hasImage, false);
    assert.equal(storyVisual(story, 1).className, "story-cover--no-image");
  }
});

test("approved HTTPS thumbnail is allowed and non-mock source attribution is required", () => {
  const approved = {
    ...real,
    thumbnailUrl: "https://images.example/approved.jpg",
    thumbnailApproved: true,
  };
  assert.ok(storySchema.safeParse(approved).success);
  const image = storyVisual(approved, 2);
  assert.equal(image.hasImage, true);
  assert.equal(image.className, "story-cover--authorized-image");
  assert.match(image.backgroundImage, /images\.example\/approved\.jpg/);
  assert.equal(
    storySchema.safeParse({ ...approved, sourceUrl: null }).success,
    false,
  );
});
