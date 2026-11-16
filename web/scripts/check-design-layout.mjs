import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.DESIGN_PREVIEW_URL || "http://127.0.0.1:3000";
const output = "artifacts/design-preview";
const widths = [320, 375, 768, 1280];
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(output, { recursive: true });
  for (const width of widths) {
    const page = await browser.newPage({
      viewport: { width, height: 820 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      locale: "zh-TW",
    });
    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, `HTTP 200 at ${width}px`);
    await page.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    await page.locator('[data-testid="testimony-card"]').nth(3).waitFor();
    assert.equal(await page.locator('[data-testid="testimony-card"]').count(), 4);
    assert.equal(await page.locator(".story-cover").count(), 4);
    assert.equal(await page.getByText("所有故事與圖片均為示意", { exact: false }).count(), 1);

    const layout = await page.evaluate(() => {
      const viewport = window.innerWidth;
      const overflowing = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > viewport + 2)
        .slice(0, 8)
        .map((el) => ({ name: el.tagName.toLowerCase(), right: Math.round(el.getBoundingClientRect().right) }));
      const backgrounds = [...document.querySelectorAll(".story-cover")].map((el) => getComputedStyle(el).backgroundImage);
      const hasBackground = backgrounds.length === 4 && backgrounds.every((value) => value !== "none") && new Set(backgrounds).size === 4;
      return { viewport, scrollWidth: document.documentElement.scrollWidth, overflowing, hasBackground, backgrounds };
    });
    assert.ok(layout.scrollWidth <= width + 1 && layout.overflowing.length === 0,
      `Horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
    assert.ok(layout.hasBackground, "All four cards require a background image");

    const buttons = page.getByRole("group", { name: /的回饋/ }).first();
    const save = buttons.getByRole("button", { name: "收藏" });
    assert.equal(await save.getAttribute("aria-pressed"), "false");
    await save.click();
    assert.equal(await buttons.getByRole("button", { name: "已收藏" }).getAttribute("aria-pressed"), "true");
    await buttons.getByRole("button", { name: "已收藏" }).click();
    assert.equal(await save.getAttribute("aria-pressed"), "false");

    await page.screenshot({ path: `${output}/feed-${width}.png`, fullPage: true, animations: "disabled" });
    const first = page.locator('[data-testid="story-open"]').first();
    await first.click();
    await page.getByRole("heading", { name: "在新的地方，重新找到盼望" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/stories/00000000-0000-4000-8000-000000000101");
    const articleWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(articleWidth <= width + 1, `Article overflow at ${width}px`);
    await page.screenshot({ path: `${output}/article-${width}.png`, fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "← 返回故事" }).click();
    await page.getByRole("heading", { name: "為你挑選的故事" }).waitFor();
    console.log(`PASS ${width}px: feed, article, images, actions, no overflow`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 375, height: 820 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const first = page.locator('[data-testid="story-open"]').first();
  await first.focus();
  assert.ok(await first.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
  }), "Card link needs a visible keyboard focus outline");
  console.log("PASS: keyboard focus is visible");
  await page.close();
} finally {
  await browser.close();
}
