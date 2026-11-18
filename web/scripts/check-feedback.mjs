import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.FEEDBACK_CHROME_PATH
    ? { executablePath: process.env.FEEDBACK_CHROME_PATH }
    : {}),
});
const baseUrl = process.env.FEED_TEST_URL ?? "http://127.0.0.1:3000";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stories = Array.from({ length: 6 }, (_, i) => ({
  id: uuid(901 + i),
  contentType: "testimony",
  title: `測試故事 ${i + 1}`,
  summary: "虛構的測試摘要",
  sourceName: "測試來源",
  sourceUrl: "https://example.org/story",
  topics: ["希望"],
  publishedAt: "2026-01-01T00:00:00.000Z",
  isMock: false,
}));
const states = new Map();
const events = new Map();
const replies = new Map();
const requestIds = [];
let nextEvent = 1100;
let failNext = false;
let failAfterCommit = false;
let holdUndo = false;
let releaseUndo;
const undoGate = new Promise((resolve) => {
  releaseUndo = resolve;
});

try {
  const page = await browser.newPage({
    viewport: { width: 375, height: 820 },
    locale: "zh-TW",
  });
  await page.route("**/api/feed**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/feed")
      return route.fulfill({
        status: 200,
        json: { accepted: true, eventId: uuid(999) },
      });
    const start = new URL(route.request().url()).searchParams.has("cursor")
      ? 4
      : 0;
    const batch = start
      ? [stories[0], ...stories.slice(4)]
      : stories.slice(0, 4);
    const items = batch.map((story, i) => ({ ...story, rank: start + i + 1 }));
    await route.fulfill({
      json: {
        items,
        nextCursor: start ? null : "next-page",
        batchId: uuid(start ? 1202 : 1201),
        feedVariant: "baseline",
        safetyState: "normal",
        mock: false,
      },
    });
  });
  await page.route("**/api/saved**", async (route) => {
    await route.fulfill({
      json: {
        items: stories.filter((story) => states.get(story.id)?.saved),
        nextCursor: null,
      },
    });
  });
  await page.route("**/api/feedback", async (route) => {
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: {} });
    }
    const input = route.request().postDataJSON();
    if (input.action === "undo" && holdUndo) {
      holdUndo = false;
      await undoGate;
    }
    requestIds.push(input.requestId);
    if (replies.has(input.requestId))
      return route.fulfill({ json: replies.get(input.requestId) });
    const previous = {
      reaction: null,
      saved: false,
      ...states.get(input.testimonyId),
    };
    const next = { ...previous };
    if (input.action === "undo")
      Object.assign(next, events.get(input.undoEventId));
    if (input.action === "interested" || input.action === "not_for_me")
      next.reaction = input.action;
    if (input.action === "save" || input.action === "unsave")
      next.saved = input.action === "save";
    const eventId = uuid(nextEvent++);
    events.set(eventId, previous);
    states.set(input.testimonyId, next);
    const result = { eventId, testimonyId: input.testimonyId, ...next };
    replies.set(input.requestId, result);
    if (failAfterCommit) {
      failAfterCommit = false;
      return route.abort();
    }
    await route.fulfill({ json: result });
  });

  await page.goto(baseUrl);
  const first = page.getByRole("group", { name: "測試故事 1的回饋" });
  await first.getByRole("button", { name: "收藏", exact: true }).click();
  await first.getByRole("button", { name: "已收藏" }).waitFor();
  await page.getByRole("link", { name: "我的收藏" }).click();
  await page.getByTestId("saved-grid").waitFor();
  await page.reload();
  await page.getByTestId("saved-grid").waitFor();
  assert.equal(
    await page.getByTestId("saved-grid").getByText("測試故事 1").count(),
    1,
  );
  await page.getByTestId("saved-grid").getByTestId("story-open").click();
  await page.getByRole("heading", { name: "測試故事 1" }).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "前往原始見證 ↗" })
      .getAttribute("href"),
    "https://example.org/story",
  );
  await page.goBack();
  await page.getByTestId("saved-grid").waitFor();
  await page.getByRole("button", { name: "已收藏" }).click();
  await page.getByText("還沒有收藏的故事").waitFor();
  await page.getByRole("button", { name: "復原" }).click();
  await page.getByTestId("saved-grid").waitFor();
  await page.getByRole("link", { name: "← 返回故事" }).click();
  await page.waitForURL(baseUrl + "/");
  await first.waitFor();
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  await page.waitForFunction(() => window.scrollY > 0);
  const scrollBeforeHide = await page.evaluate(() => window.scrollY);
  await first.getByRole("button", { name: "不適合我" }).click();
  await first.waitFor({ state: "detached" });
  const scrollAfterHide = await page.evaluate(() => window.scrollY);
  assert.ok(
    scrollBeforeHide > 0 && scrollAfterHide > 0,
    `hiding a story must not reset the feed to the top (before ${scrollBeforeHide}, after ${scrollAfterHide})`,
  );
  assert.equal(await first.count(), 0);
  await page.getByRole("button", { name: "載入更多故事" }).click();
  await page.getByText("測試故事 6").waitFor();
  assert.equal(await first.count(), 0);
  await page.getByRole("button", { name: "復原" }).click();
  await first.waitFor();
  const second = page.getByRole("group", { name: "測試故事 2的回饋" });
  failNext = true;
  await second.getByRole("button", { name: "感興趣" }).click();
  await page.getByRole("alert").filter({ hasText: "無法更新" }).waitFor();
  assert.equal(
    await second
      .getByRole("button", { name: "感興趣" })
      .getAttribute("aria-pressed"),
    "false",
  );
  await second.getByRole("button", { name: "感興趣" }).click();
  await second.getByRole("button", { name: "感興趣", pressed: true }).waitFor();
  assert.equal(
    await second.getByRole("button", { name: "感興趣" }).isDisabled(),
    true,
  );
  assert.equal(
    await second
      .getByRole("button", { name: "感興趣" })
      .getAttribute("aria-pressed"),
    "true",
  );
  failAfterCommit = true;
  await second.getByRole("button", { name: "收藏", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "無法更新" }).waitFor();
  await second.getByRole("button", { name: "收藏", exact: true }).click();
  await second.getByRole("button", { name: "已收藏" }).waitFor();
  assert.equal(
    requestIds.at(-1),
    requestIds.at(-2),
    "retry must reuse the original request ID",
  );
  holdUndo = true;
  const undoRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/feedback") &&
      request.postDataJSON()?.action === "undo",
  );
  await page.getByRole("button", { name: "復原" }).click();
  await undoRequest;
  await first.getByRole("button", { name: "感興趣" }).click();
  await first.getByRole("button", { name: "感興趣", pressed: true }).waitFor();
  releaseUndo();
  await second.getByRole("button", { name: "收藏", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "復原" }).count(),
    1,
    "a delayed undo must not erase a newer action's undo",
  );
  console.log(
    "PASS: feedback, undo, Saved reload, pagination, and failed-request recovery",
  );
} finally {
  await browser.close();
}
