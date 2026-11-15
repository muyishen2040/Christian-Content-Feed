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
    await page.getByRole("heading", { name: /故事，/ }).waitFor();
    assert.equal(await page.locator('[data-testid="testimony-card"]').count(), 4);
    assert.equal(await page.getByText("所有故事、來源名稱及互動都是虛構測試資料", { exact: false }).count(), 1);

    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const viewport = window.innerWidth;
      const overflowing = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > viewport + 2)
        .slice(0, 8)
        .map((el) => ({
          name: el.tagName.toLowerCase(),
          className: String(el.className || "").slice(0, 110),
          right: Math.round(el.getBoundingClientRect().right),
        }));
      return { viewport, scrollWidth: root.scrollWidth, overflowing };
    });
    assert.ok(
      layout.scrollWidth <= layout.viewport + 1 && layout.overflowing.length === 0,
      `Horizontal overflow at ${width}px: ${JSON.stringify(layout)}`,
    );
    const buttons = page.getByRole("group", { name: /的回饋/ }).first();
    const save = buttons.getByRole("button", { name: "收藏" });
    assert.equal(await save.getAttribute("aria-pressed"), "false");
    await save.click();
    assert.equal(await buttons.getByRole("button", { name: "已收藏" }).getAttribute("aria-pressed"), "true");
    await buttons.getByRole("button", { name: "已收藏" }).click();
    assert.equal(await save.getAttribute("aria-pressed"), "false");
    await page.screenshot({
      path: `${output}/home-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    console.log(`PASS ${width}px: no horizontal overflow; mock controls and screen labels work`);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 375, height: 820 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const primary = page.getByRole("link", { name: "看看示意故事" });
  await primary.focus();
  assert.ok(await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
  }), "Primary link needs a visible focus outline");
  await page.close();
  console.log("PASS: keyboard focus state is visible");
} finally {
  await browser.close();
}
