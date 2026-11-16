import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.FEED_TEST_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stories = Array.from({ length: 6 }, (_, i) => ({
  id: uuid(i + 401),
  contentType: "testimony",
  title: `測試見證故事 ${i + 1}`,
  summary: `第 ${i + 1} 篇測試摘要，僅用於檢查分頁和來源連結。`,
  sourceName: `測試出版者 ${i + 1}`,
  sourceUrl: `https://example.org/story/${i + 1}`,
  ...(i < 2
    ? { thumbnailUrl: "https://images.example.org/scene.jpg", thumbnailApproved: i === 0 }
    : {}),
  topics: ["希望"],
  publishedAt: "2026-01-01T00:00:00.000Z",
  isMock: false,
}));

function payload(indices, token = null, batch = 501) {
  return {
    items: indices.map((index) => ({ ...stories[index], rank: index + 1 })),
    nextCursor: token,
    batchId: uuid(batch),
    feedVariant: "baseline",
    safetyState: "normal",
    mock: false,
  };
}

function feedPath(url) {
  return new URL(url).pathname === "/api/feed";
}
function eventPath(url) {
  return new URL(url).pathname === "/api/feed/events";
}

async function newPage() {
  return browser.newPage({
    viewport: { width: 375, height: 820 },
    locale: "zh-TW",
    reducedMotion: "reduce",
  });
}

try {
  // Full production-mode HTTP adapter, with network responses intercepted
  // before reaching any real service or publisher. No authentic content used.
  const page = await newPage();
  const events = [];
  const cursors = [];
  // Hold the first mocked response until the loading state has actually been
  // observed. An immediately fulfilled mock can skip the transient skeleton.
  let releaseInitialResponse;
  const initialResponseGate = new Promise((resolve) => {
    releaseInitialResponse = resolve;
  });
  await page.route(feedPath, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    const response = cursor
      ? payload([3, 4, 5], null, 502) // overlap tests client deduplication
      : payload([0, 1, 2, 3], "next-page", 501);
    if (!cursor) await initialResponseGate;
    await route.fulfill({ status: 200, json: response });
  });
  await page.route(eventPath, async (route) => {
    const event = JSON.parse(route.request().postData() || "{}");
    events.push(event);
    await route.fulfill({
      status: 200,
      json: { accepted: true, eventId: event.eventId },
    });
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("feed-loading").waitFor();
  releaseInitialResponse();
  await page.locator('[data-testid="testimony-card"]').nth(3).waitFor();
  assert.equal(await page.locator('[data-testid="testimony-card"]').count(), 4);
  assert.equal(await page.locator(".story-cover--authorized-image").count(), 1);
  assert.equal(await page.locator(".story-cover--no-image").count(), 3);
  assert.equal(await page.getByText("精選故事 · 從這裡開始探索").count(), 1);
  const original = page.getByRole("link", { name: /前往原始見證：測試見證故事 1/ });
  assert.equal(await original.getAttribute("href"), "https://example.org/story/1");
  assert.equal(await original.getAttribute("target"), "_blank");

  await page.waitForTimeout(1500);
  assert.ok(events.some((event) =>
    event.eventName === "impression" &&
    event.testimonyId === stories[0].id &&
    event.rank === 1 &&
    event.batchId === uuid(501) &&
    event.feedVariant === "baseline"
  ), "At least the first visibly viewed card should emit a batch-attributed impression");
  assert.equal(
    events.filter((event) => event.eventName === "impression" && event.testimonyId === stories[0].id).length,
    1,
    "An already measured story must not emit duplicate impressions",
  );

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator('[data-testid="testimony-card"]').nth(5).waitFor();
  assert.equal(await page.locator('[data-testid="testimony-card"]').count(), 6);
  assert.ok(cursors.includes("next-page"), "The next opaque cursor must be sent unchanged");
  assert.equal(await page.getByTestId("load-more").count(), 0);
  const lastStory = page.locator('[data-testid="story-open"]').nth(5);
  await lastStory.scrollIntoViewIfNeeded();
  const beforeArticle = await page.evaluate(() => window.scrollY);
  assert.ok(beforeArticle > 400, "The deep feed card must require scrolling");
  await lastStory.click();
  await page.getByRole("heading", { name: "測試見證故事 6" }).waitFor();
  assert.equal(await page.getByText("本頁僅提供經審核的摘要。", { exact: false }).count(), 1);
  assert.equal(await page.locator(".article-paragraph").count(), 0,
    "Real story source text must never be invented or rehosted");
  assert.equal(
    await page.getByRole("link", { name: "前往原始見證 ↗" }).getAttribute("href"),
    "https://example.org/story/6",
  );
  await page.getByRole("link", { name: "← 返回故事" }).click();
  await page.locator('[data-testid="testimony-card"]').nth(5).waitFor();
  assert.equal(await page.locator('[data-testid="testimony-card"]').count(), 6);
  try {
    await page.waitForFunction(() => window.scrollY > 400, null, { timeout: 8000 });
  } catch {
    const returnedTo = await page.evaluate(() => ({
      scrollY: window.scrollY,
      stored: window.sessionStorage.getItem("testimony-feed:scroll-position"),
      scrollHeight: document.documentElement.scrollHeight,
    }));
    throw new Error(`Feed scroll restoration failed (before ${beforeArticle}, after ${JSON.stringify(returnedTo)})`);
  }
  console.log("PASS: page loading, authorized thumbnails, source attribution, measured impressions, deduplicated pagination, article and scroll restore");
  await page.close();

  const empty = await newPage();
  await empty.route(feedPath, (route) => route.fulfill({ json: payload([], null, 503) }));
  await empty.goto(baseUrl);
  await empty.getByTestId("feed-empty").waitFor();
  console.log("PASS: accessible empty state");
  await empty.close();

  const failed = await newPage();
  let calls = 0;
  await failed.route(feedPath, (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 503, json: { error: "Simulated unavailable" } })
      : route.fulfill({ json: payload([0, 1], null, 504) });
  });
  await failed.goto(baseUrl);
  await failed.getByTestId("feed-error").waitFor();
  await failed.getByRole("button", { name: "重試載入" }).click();
  await failed.locator('[data-testid="testimony-card"]').nth(1).waitFor();
  assert.equal(calls, 2);
  console.log("PASS: accessible error and retry state");
  await failed.close();
} finally {
  await browser.close();
}
