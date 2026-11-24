import test from "node:test";
import assert from "node:assert/strict";
import {
  consentFromRow,
  consentInputSchema,
  consentRowPatch,
} from "../lib/consent.ts";
import { isTrustedMutation } from "../lib/csrf.ts";
import {
  handleCreateSession,
  handleGetConsent,
  handleGetSession,
  handlePutConsent,
} from "../lib/session-api.ts";

const ORIGIN = "https://app.example.test";
const A = "00000000-0000-4000-8000-0000000000a1";
const PREFS = { consentStorePreferences: true, consentKeepText: false };

function req(method, path, { origin = ORIGIN, body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (origin) h.set("origin", origin);
  return new Request(ORIGIN + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deps(over = {}) {
  const calls = { signIn: 0, writes: [], reads: [] };
  const d = {
    getUser: async () => ({ id: A }),
    signInAnonymously: async () => {
      calls.signIn += 1;
      return { id: A };
    },
    readConsent: async (id) => {
      calls.reads.push(id);
      return PREFS;
    },
    writeConsent: async (id, c) => void calls.writes.push([id, c]),
    ...over,
  };
  return { d, calls };
}

// ---- consent model ----

test("keeping text requires consent to store preferences, and unknown keys are refused", () => {
  const ok = { consentStorePreferences: true, consentKeepText: true };
  assert.deepEqual(consentInputSchema.parse(ok), ok);
  const bad = [
    { consentStorePreferences: false, consentKeepText: true },
    { ...ok, description: "x" },
    { consentStorePreferences: "yes", consentKeepText: false },
    {},
  ];
  for (const input of bad) {
    assert.equal(consentInputSchema.safeParse(input).success, false);
  }
});

test("withdrawing consent clears what it covered", () => {
  const none = consentRowPatch({
    consentStorePreferences: false,
    consentKeepText: false,
  });
  assert.deepEqual(none, {
    consent_to_personalization: false,
    consent_keep_text: false,
    topics: [],
    preference_embedding: null,
    preference_model_version: null,
    description_ciphertext: null,
  });
  const prefsOnly = consentRowPatch(PREFS);
  assert.equal(prefsOnly.description_ciphertext, null);
  assert.equal("preference_embedding" in prefsOnly, false); // keeps stored preferences
  const all = consentRowPatch({
    consentStorePreferences: true,
    consentKeepText: true,
  });
  assert.equal("description_ciphertext" in all, false); // never clears text the visitor chose to keep
});

test("consent read from a row defaults to none and never reports text without preferences", () => {
  const off = { consentStorePreferences: false, consentKeepText: false };
  assert.deepEqual(consentFromRow(null), off);
  assert.deepEqual(
    consentFromRow({
      consent_to_personalization: false,
      consent_keep_text: true,
    }),
    off,
  );
  assert.deepEqual(
    consentFromRow({
      consent_to_personalization: true,
      consent_keep_text: true,
    }),
    { consentStorePreferences: true, consentKeepText: true },
  );
});

// ---- same-origin check ----

test("only same-origin mutations are trusted", () => {
  const post = (opts) => req("POST", "/api/session", opts);
  assert.equal(isTrustedMutation(post()), true);
  for (const origin of ["https://evil.test", "null", ORIGIN + ".evil.test"]) {
    assert.equal(isTrustedMutation(post({ origin })), false);
  }
  assert.equal(isTrustedMutation(post({ origin: null })), false);
  const fetchSite = (v) =>
    post({ origin: null, headers: { "sec-fetch-site": v } });
  assert.equal(isTrustedMutation(fetchSite("same-origin")), true);
  assert.equal(isTrustedMutation(fetchSite("cross-site")), false);
});

// ---- session ----

test("a first-time visitor has no session and reading it creates none", async () => {
  const { d, calls } = deps({ getUser: async () => null });
  const res = await handleGetSession(d);
  assert.deepEqual(await res.json(), { hasSession: false });
  assert.equal(calls.signIn, 0);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("POST /api/session creates one anonymous session, once, and returns no id", async () => {
  let existing = null;
  const { d, calls } = deps({
    getUser: async () => existing,
    signInAnonymously: async () => {
      calls.signIn += 1;
      existing = { id: A };
      return existing;
    },
  });
  const first = await handleCreateSession(req("POST", "/api/session"), d);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { hasSession: true });
  const second = await handleCreateSession(req("POST", "/api/session"), d);
  assert.equal(second.status, 200);
  assert.equal(calls.signIn, 1);
});

test("a cross-site POST /api/session is refused before any sign-in", async () => {
  const { d, calls } = deps({ getUser: async () => null });
  const evil = req("POST", "/api/session", { origin: "https://evil.test" });
  assert.equal((await handleCreateSession(evil, d)).status, 403);
  assert.equal(calls.signIn, 0);
});

test("a failed sign-in or an Auth outage is a 503 that reveals nothing", async () => {
  const none = deps({
    getUser: async () => null,
    signInAnonymously: async () => null,
  });
  const noSession = await handleCreateSession(
    req("POST", "/api/session"),
    none.d,
  );
  assert.equal(noSession.status, 503);
  const boom = deps({
    getUser: async () => {
      throw new Error("secret-detail");
    },
  });
  const res = await handleCreateSession(req("POST", "/api/session"), boom.d);
  assert.equal(res.status, 503);
  assert.equal((await res.text()).includes("secret-detail"), false);
});

// ---- consent endpoints ----

test("consent needs a session, and the user id comes from the session not the body", async () => {
  const anon = deps({ getUser: async () => null });
  assert.equal((await handleGetConsent(anon.d)).status, 401);
  const put = await handlePutConsent(
    req("PUT", "/api/consent", { body: PREFS }),
    anon.d,
  );
  assert.equal(put.status, 401);
  assert.equal(anon.calls.writes.length, 0);

  const { d, calls } = deps();
  const sneaky = await handlePutConsent(
    req("PUT", "/api/consent", { body: { ...PREFS, userId: "someone-else" } }),
    d,
  );
  assert.equal(sneaky.status, 400); // unknown keys refused, so no id can be smuggled in
  assert.equal(calls.writes.length, 0);

  const ok = await handlePutConsent(
    req("PUT", "/api/consent", { body: PREFS }),
    d,
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.writes, [[A, PREFS]]);
});

test("consent changes need a same-origin request and a valid small JSON body", async () => {
  const { d, calls } = deps();
  const cross = req("PUT", "/api/consent", {
    origin: "https://evil.test",
    body: PREFS,
  });
  assert.equal((await handlePutConsent(cross, d)).status, 403);
  const put = (body) =>
    new Request(ORIGIN + "/api/consent", {
      method: "PUT",
      headers: { origin: ORIGIN },
      body,
    });
  assert.equal((await handlePutConsent(put("{nope"), d)).status, 400);
  assert.equal((await handlePutConsent(put("x".repeat(2000)), d)).status, 400);
  const keepWithoutStore = JSON.stringify({
    consentStorePreferences: false,
    consentKeepText: true,
  });
  assert.equal((await handlePutConsent(put(keepWithoutStore), d)).status, 400);
  assert.equal(calls.writes.length, 0);
});

test("GET /api/consent returns only the visitor's own flags", async () => {
  const { d, calls } = deps();
  const res = await handleGetConsent(d);
  assert.deepEqual(await res.json(), { consent: PREFS });
  assert.deepEqual(calls.reads, [A]);
});
