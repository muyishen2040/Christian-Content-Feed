import type { FeedResponse, FeedEventRequest } from "./contracts.ts";

export type FeedEntry = {
  story: FeedResponse["items"][number];
  batchId: string;
  feedVariant: FeedResponse["feedVariant"];
};

export function mergeFeedPage(
  current: FeedEntry[],
  response: FeedResponse,
): FeedEntry[] {
  const ids = new Set(current.map((entry) => entry.story.id));
  const result = [...current];
  for (const story of response.items) {
    if (ids.has(story.id)) continue;
    ids.add(story.id);
    result.push({
      story,
      batchId: response.batchId,
      feedVariant: response.feedVariant,
    });
  }
  return result;
}

export function feedEventFor(
  entry: FeedEntry,
  pageViewId: string,
  eventName: FeedEventRequest["eventName"],
  eventId: string,
): FeedEventRequest {
  return {
    eventId,
    testimonyId: entry.story.id,
    batchId: entry.batchId,
    pageViewId,
    rank: entry.story.rank,
    feedVariant: entry.feedVariant,
    eventName,
  };
}
