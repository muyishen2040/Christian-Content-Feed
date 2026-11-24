import test from "node:test";
import assert from "node:assert/strict";
import { handleStagingCheck } from "../lib/staging-check.ts";

const env = {
  VERCEL_ENV: "preview",
  ENABLE_STAGING_CHECK: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://ejvymlkjxcupnkxtzdtv.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
};
const approved = [
  { id: "00000000-0000-4000-8000-0000000000f1" },
  { id: "00000000-0000-4000-8000-0000000000f2" },
];

test("staging check is disabled by default and never runs in production", async () => {
  for (const changes of [
    { ENABLE_STAGING_CHECK: undefined },
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: undefined },
  ]) {
    const result = await handleStagingCheck({ ...env, ...changes }, () =>
      assert.fail("unexpected fetch"),
    );
    assert.equal(result.status, 404);
  }
});

test("staging check rejects other databases and nonpublic keys before fetching", async () => {
  for (const changes of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_not_public" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
  ]) {
    const result = await handleStagingCheck({ ...env, ...changes }, () =>
      assert.fail("unexpected fetch"),
    );
    assert.equal(result.status, 503);
  }
});

test("staging check reads only expected fixtures and reports success", async () => {
  const result = await handleStagingCheck(env, async (url, options) => {
    assert.equal(new URL(url).host, "ejvymlkjxcupnkxtzdtv.supabase.co");
    assert.equal(new URL(url).pathname, "/rest/v1/published_testimonies");
    assert.equal(options.headers.apikey, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(options.redirect, "error");
    return Response.json(approved);
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true });
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("staging check fails when a draft is visible, a fixture is missing or request fails", async () => {
  for (const result of [
    Response.json([
      ...approved,
      { id: "00000000-0000-4000-8000-0000000000f3" },
    ]),
    Response.json(approved.slice(0, 1)),
    new Response("failure", { status: 500 }),
  ]) {
    const response = await handleStagingCheck(env, async () => result);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false });
  }
  assert.equal(
    (
      await handleStagingCheck(env, async () => {
        throw new Error("offline");
      })
    ).status,
    502,
  );
});
