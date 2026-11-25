import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { refreshSession } from "../proxy.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test";

function request(cookie = "sb-test-auth-token=abc") {
  return new NextRequest("https://app.test/api/consent", {
    headers: cookie ? { cookie } : {},
  });
}

// A fake Auth client. `outcome` decides what getUser() does; the cookie writes it asks for are
// delivered through setAll, as the real client does.
function factory(outcome) {
  return (_url, _key, { cookies }) => ({
    auth: {
      async getUser() {
        await outcome(cookies);
        return outcome.result;
      },
    },
  });
}

function fake(result, writes = []) {
  const run = async (cookies) => {
    if (writes.length) cookies.setAll(writes);
  };
  run.result = result;
  return factory(run);
}

test("a refresh conflict (409) returns a retryable error and keeps the cookies", async () => {
  const clear = [
    { name: "sb-test-auth-token", value: "", options: { maxAge: 0 } },
  ];
  const res = await refreshSession(
    request(),
    fake(
      { data: { user: null }, error: { status: 409, name: "AuthApiError" } },
      clear,
    ),
  );
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "1");
  assert.equal(res.headers.get("set-cookie"), null); // the visitor's cookie is not cleared
  assert.equal((await res.json()).error.code, "session_refresh_conflict");
});

test("network errors and 5xx also keep the session", async () => {
  for (const error of [
    { status: 500, name: "AuthApiError" },
    { status: 0, name: "AuthRetryableFetchError" },
  ]) {
    const res = await refreshSession(
      request(),
      fake({ data: { user: null }, error }),
    );
    assert.equal(res.status, 503);
  }
});

test("a successful refresh passes the request on with rewritten cookies", async () => {
  const fresh = [{ name: "sb-test-auth-token", value: "new", options: {} }];
  const res = await refreshSession(
    request(),
    fake({ data: { user: { id: "u" } }, error: null }, fresh),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie") ?? "", /sb-test-auth-token=new/);
  assert.match(res.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("an invalid token is not a temporary error: cookies are cleared as the client asks", async () => {
  const clear = [
    { name: "sb-test-auth-token", value: "", options: { maxAge: 0 } },
  ];
  const res = await refreshSession(
    request(),
    fake(
      { data: { user: null }, error: { status: 401, name: "AuthApiError" } },
      clear,
    ),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie") ?? "", /sb-test-auth-token=;/);
});

test("a visitor without Supabase cookies costs no Auth call", async () => {
  let called = false;
  const res = await refreshSession(request(""), () => {
    called = true;
  });
  assert.equal(res.status, 200);
  assert.equal(called, false);
});
