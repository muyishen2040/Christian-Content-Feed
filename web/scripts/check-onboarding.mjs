import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.ONBOARDING_TEST_URL ?? "http://127.0.0.1:3000";
const mode = process.env.NEXT_PUBLIC_FEED_API_MODE === "http" ? "http" : "mock";
const directory = `artifacts/onboarding-${mode}`;
const browser = await chromium.launch({ headless: true });

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function response(feedVariant = "baseline") {
  return {
    items: [
      {
        id: id(801),
        contentType: "testimony",
        title: "測試用的見證故事",
        summary: "用來驗證可選的個人化流程，不是真實人物的見證。",
        sourceName: "測試出版者",
        sourceUrl: "https://example.org/test-story",
        topics: ["希望"],
        publishedAt: "2026-01-01T00:00:00.000Z",
        isMock: false,
        rank: 1,
      },
    ],
    nextCursor: null,
    batchId: id(802),
    feedVariant,
    safetyState: "normal",
    mock: false,
  };
}

async function makePage(width = 375) {
  const page = await browser.newPage({
    viewport: { width, height: 820 },
    locale: "zh-TW",
    reducedMotion: "reduce",
  });
  if (mode === "http") {
    await page.route((url) => url.pathname === "/api/feed", (route) =>
      route.fulfill({ status: 200, json: response() }),
    );
    await page.route((url) => url.pathname === "/api/feed/events", (route) =>
      route.fulfill({
        status: 200,
        json: {
          accepted: true,
          eventId: id(803),
        },
      }),
    );
  }
  return page;
}

async function assertNoOverflow(page, width) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 2)
      .slice(0, 6)
      .map((element) => element.tagName.toLowerCase()),
  }));
  assert.ok(
    layout.document <= width + 1 && layout.overflowing.length === 0,
    `Horizontal overflow: ${JSON.stringify(layout)}`,
  );
}

async function capture(page, width) {
  await page.screenshot({
    path: `${directory}/personalize-${width}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

try {
  await mkdir(directory, { recursive: true });

  // The feed is still the entry point. Welcome is dismissible and never a wall.
  const home = await makePage();
  await home.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await home.getByTestId("welcome-prompt").waitFor();
  await home.getByRole("link", { name: "讓故事更貼近我" }).waitFor();
  assert.equal(await home.getByRole("heading", { name: "為你挑選的故事" }).count(), 1);
  await home.getByRole("button", { name: "略過，直接探索" }).click();
  assert.equal(await home.getByTestId("welcome-prompt").count(), 0);
  await home.reload();
  assert.equal(await home.getByTestId("welcome-prompt").count(), 0);
  await home.getByRole("link", { name: "調整推薦" }).click();
  await home.getByRole("heading", { name: "最近，有什麼放在心上？" }).waitFor();
  await home.getByRole("link", { name: "現在需要幫助？" }).click();
  await home.getByRole("heading", { name: "需要有人陪你走過此刻嗎？" }).waitFor();
  await home.close();
  console.log("PASS: feed-first welcome, dismiss without profile calls, return visit and help link");

  for (const width of [320, 375, 768, 1280]) {
    const page = await makePage(width);
    await page.goto(`${baseUrl}/personalize`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "最近，有什麼放在心上？" }).waitFor();
    await assertNoOverflow(page, width);
    assert.equal(await page.locator("#personal-description").getAttribute("required"), null);
    assert.equal(await page.locator("#age-range").getAttribute("required"), null);
    assert.equal(await page.locator("#gender").getAttribute("required"), null);
    assert.equal(await page.locator("#age-range option[value='prefer_not_to_say']").count(), 1);
    assert.equal(await page.locator("#gender option[value='prefer_not_to_say']").count(), 1);
    assert.equal(await page.locator("input[type=checkbox]").isChecked(), false);
    await capture(page, width);
    await page.close();
    console.log(`PASS: ${mode} onboarding layout at ${width}px`);
  }

  if (mode === "mock") {
    const blank = await makePage();
    await blank.goto(`${baseUrl}/personalize`);
    await blank.getByTestId("show-my-feed").click();
    await blank.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    await blank.locator('[data-testid="testimony-card"]').first().waitFor();
    assert.equal(await blank.getByText("精選故事 · 從這裡開始探索").count(), 1);
    console.log("PASS: completely blank optional form yields curated feed");
    await blank.close();

    const filled = await makePage();
    await filled.goto(`${baseUrl}/personalize`);
    const description = "測試心情，不應出現在瀏覽器儲存空間";
    await filled.locator("#personal-description").fill(description);
    await filled.locator("#age-range").selectOption("25-34");
    await filled.locator("#gender").selectOption("prefer_not_to_say");
    await filled.getByTestId("show-my-feed").click();
    await filled.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    await filled.locator('[data-testid="testimony-card"]').first().waitFor();
    assert.equal(await filled.getByText("精選故事 · 從這裡開始探索").count(), 0);
    const stored = await filled.evaluate(() =>
      JSON.stringify({
        local: Object.entries(window.localStorage),
        session: Object.entries(window.sessionStorage),
      }),
    );
    assert.equal(stored.includes(description), false);
    console.log("PASS: voluntary text used in current mock session without local storage");
    await filled.close();
  } else {
    const blank = await makePage();
    let emptySubmissions = 0;
    await blank.route((url) => url.pathname === "/api/profile", async (route) => {
      emptySubmissions++;
      const input = JSON.parse(route.request().postData() || "{}");
      assert.deepEqual(input, {
        description: null,
        topics: [],
        consentStorePreferences: false,
        consentKeepText: false,
      });
      await route.fulfill({
        json: {
          profile: input,
          safetyState: "normal",
          feedMode: "default",
        },
      });
    });
    await blank.goto(`${baseUrl}/personalize`);
    await blank.getByTestId("show-my-feed").click();
    await blank.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    await blank.locator('[data-testid="testimony-card"]').first().waitFor();
    assert.equal(emptySubmissions, 1);
    console.log("PASS: empty form submits strict default profile contract");
    await blank.close();

    const personalized = await makePage();
    let submitted;
    await personalized.route((url) => url.pathname === "/api/profile", async (route) => {
      submitted = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        json: {
          profile: {
            ...submitted,
            description: null,
          },
          safetyState: "normal",
          feedMode: "personalized",
        },
      });
    });
    await personalized.goto(`${baseUrl}/personalize`);
    await personalized.locator("#personal-description").fill("最近搬到新地方，有些孤單");
    await personalized.locator("#age-range").selectOption("25-34");
    await personalized.locator("#gender").selectOption("prefer_not_to_say");
    await personalized.locator("input[type=checkbox]").check();
    await personalized.getByTestId("show-my-feed").click();
    await personalized.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    assert.equal(submitted.description, "最近搬到新地方，有些孤單");
    assert.equal(submitted.ageRange, "25-34");
    assert.equal(submitted.gender, "prefer_not_to_say");
    assert.equal(submitted.consentStorePreferences, true);
    assert.equal(submitted.consentKeepText, false);
    console.log("PASS: personalization submits consented, strictly typed profile without text retention");
    await personalized.close();

    const support = await makePage();
    await support.route((url) => url.pathname === "/api/profile", (route) =>
      route.fulfill({
        json: { profile: null, safetyState: "support", feedMode: "support" },
      }),
    );
    await support.goto(`${baseUrl}/personalize`);
    await support.locator("#personal-description").fill("用於測試的支援回應");
    await support.getByTestId("show-my-feed").click();
    await support.getByRole("heading", { name: "需要有人陪你走過此刻嗎？" }).waitFor();
    await support.getByRole("link", { name: "先看看故事" }).click();
    await support.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    console.log("PASS: support response chooses a separate safe view and default feed access");
    await support.close();

    // A slow profile response must not override an explicit navigation away
    // from the form. The help destination remains the user's chosen page.
    const delayed = await makePage();
    let releaseProfileResponse;
    const responseGate = new Promise((resolve) => {
      releaseProfileResponse = resolve;
    });
    let confirmRequestStarted;
    const requestStarted = new Promise((resolve) => {
      confirmRequestStarted = resolve;
    });
    await delayed.route((url) => url.pathname === "/api/profile", async (route) => {
      confirmRequestStarted();
      await responseGate;
      try {
        await route.fulfill({
          json: {
            profile: {
              description: null,
              topics: [],
              consentStorePreferences: false,
              consentKeepText: false,
            },
            safetyState: "normal",
            feedMode: "personalized",
          },
        });
      } catch {
        // Navigation may cancel the outgoing request. It must still never
        // redirect the visitor away from the page they selected.
      }
    });
    await delayed.goto(`${baseUrl}/personalize`);
    await delayed.locator("#personal-description").fill("測試延遲的個人化請求");
    await delayed.getByTestId("show-my-feed").click();
    await requestStarted;
    await delayed.getByRole("link", { name: "現在需要幫助？" }).click();
    await delayed.getByRole("heading", { name: "需要有人陪你走過此刻嗎？" }).waitFor();
    releaseProfileResponse();
    await delayed.waitForTimeout(400);
    assert.equal(
      new URL(delayed.url()).pathname,
      "/support",
      "A delayed profile response must not redirect after navigating to support",
    );
    console.log("PASS: leaving the form for help is not overridden by a delayed response");
    await delayed.close();

    const retry = await makePage();
    let calls = 0;
    await retry.route((url) => url.pathname === "/api/profile", (route) => {
      calls++;
      return route.fulfill({
        status: calls === 1 ? 503 : 200,
        json:
          calls === 1
            ? { error: "Simulated failure" }
            : {
                profile: {
                  description: null,
                  topics: [],
                  consentStorePreferences: false,
                  consentKeepText: false,
                },
                feedMode: "default",
                safetyState: "normal",
              },
      });
    });
    await retry.goto(`${baseUrl}/personalize`);
    await retry.getByTestId("show-my-feed").click();
    await retry.getByTestId("onboarding-error").waitFor();
    await retry.getByTestId("show-my-feed").click();
    await retry.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    assert.equal(calls, 2);
    console.log("PASS: profile failure keeps retry path and safe generic error");
    await retry.close();

    const skip = await makePage();
    let skipRequests = 0;
    await skip.route((url) => url.pathname === "/api/profile", async (route) => {
      skipRequests++;
      await route.fulfill({ status: 500, json: {} });
    });
    await skip.goto(`${baseUrl}/personalize`);
    await skip.locator("#personal-description").fill("不可送出的內容");
    await skip.getByRole("button", { name: "略過，直接探索" }).click();
    await skip.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    assert.equal(skipRequests, 0);
    console.log("PASS: skip never sends sensitive input to profile endpoint");
    await skip.close();
  }
} finally {
  await browser.close();
}
