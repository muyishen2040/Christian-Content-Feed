import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { embedEligibleText } from "../lib/embedding-client.ts";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function configure() {
  process.env.EMBEDDING_SERVICE_URL = "https://embeddings.example.test/service";
  process.env.EMBEDDING_SERVICE_TOKEN = "test-token";
  delete process.env.EMBEDDING_SERVICE_USE_VERCEL_OIDC;
}

function result() {
  return {
    model: "BAAI/bge-small-zh-v1.5",
    revision: "7999e1d3359715c523056ef9478215996d62a620",
    export_revision: "fcecc3c5fef6becfa2b2bdda15c1c938857be534",
    dimension: 512,
    vector: [1, ...Array(511).fill(0)],
  };
}

test("sends an authenticated private request and accepts a compatible vector", async () => {
  configure();
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://embeddings.example.test/service/embed");
    assert.equal(options.headers.authorization, "Bearer test-token");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { text: "fictional", kind: "query" });
    return Response.json(result());
  };
  assert.deepEqual(await embedEligibleText("fictional", "query"), result());
});

test("rejects insecure non-local URLs before sending text", async () => {
  configure();
  process.env.EMBEDDING_SERVICE_URL = "http://other.example.test";
  globalThis.fetch = async () => { throw new Error("must not send"); };
  assert.equal(await embedEligibleText("fictional", "query"), null);
});

test("returns a safe fallback for unavailable, incompatible or invalid responses", async () => {
  configure();
  for (const response of [
    new Response("fictional", { status: 503 }),
    Response.json({ ...result(), dimension: 384 }),
    Response.json({ ...result(), vector: Array(512).fill(0) }),
    Response.json({ ...result(), export_revision: "other" }),
  ]) {
    globalThis.fetch = async () => response;
    assert.equal(await embedEligibleText("fictional", "query"), null);
  }
  globalThis.fetch = async () => { throw new Error("fictional private data"); };
  assert.equal(await embedEligibleText("fictional", "query"), null);
});

test("passes a Vercel identity token only when configured", async () => {
  configure();
  process.env.EMBEDDING_SERVICE_USE_VERCEL_OIDC = "true";
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const fictionalToken = `header.${payload}.signature`;
  process.env.VERCEL_OIDC_TOKEN = fictionalToken;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["x-vercel-trusted-oidc-idp-token"], fictionalToken);
    return Response.json(result());
  };
  assert.ok(await embedEligibleText("fictional", "query"));
});
