import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyPreview } from "./verify-preview.mjs";

const html = "<html><body>開發預覽 · 故事，陪你走一段路</body></html>";

test("running the script without a URL fails rather than silently succeeding", () => {
  const script = fileURLToPath(new URL("./verify-preview.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, PREVIEW_URL: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PREVIEW_URL must be set/);
});

test("valid preview checks HTTPS landing page without secrets", async () => {
  let received;
  const fetcher = async (url, options) => {
    received = { url: String(url), ...options };
    return new Response(html, { status: 200 });
  };
  assert.equal(await verifyPreview({
    url: "https://project-git-review-owner.vercel.app/some-path",
    bypassToken: "dummy",
    allowedHost: "project-git-review-owner.vercel.app",
    fetcher,
  }), true);
  assert.equal(received.url, "https://project-git-review-owner.vercel.app/");
  assert.equal(received.headers["x-vercel-protection-bypass"], "dummy");
});

test("refuses insecure or missing endpoints", async () => {
  await assert.rejects(() => verifyPreview({ url: "" }));
  await assert.rejects(() => verifyPreview({ url: "http://example.com" }));
});

test("does not accept access-denied or wrong-page responses", async () => {
  await assert.rejects(() => verifyPreview({
    url: "https://preview.example.com",
    fetcher: async () => new Response("sign in", { status: 403 }),
  }));
  await assert.rejects(() => verifyPreview({
    url: "https://preview.example.com",
    fetcher: async () => new Response("sign in", { status: 200 }),
  }));
});


test("bypass token never goes to an unapproved host", async () => {
  let called = false;
  await assert.rejects(() => verifyPreview({
    url: "https://attacker.vercel.app",
    bypassToken: "dummy",
    allowedHost: "project-git-review-owner.vercel.app",
    fetcher: async () => { called = true; return new Response(html); },
  }));
  assert.equal(called, false);
});
