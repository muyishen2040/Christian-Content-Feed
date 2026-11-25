import test from "node:test";
import assert from "node:assert/strict";
import {
  handleDeleteProfile,
  handleGetProfile,
  handlePutProfile,
  preferenceModelVersion,
  profileRowPatch,
} from "../lib/profile-api.ts";
import { profileResponseSchema } from "../lib/contracts.ts";

const ORIGIN = "https://app.example.test";
const A = "00000000-0000-4000-8000-0000000000a1";
const TEXT = "虛構範例：我在一個虛構的小鎮學會了感恩。";
const EMBEDDING = {
  vector: [0.6, 0.8],
  model: "test-model",
  revision: "rev1",
  export_revision: "exp1",
};
const BASE = {
  description: TEXT,
  topics: ["感恩"],
  consentStorePreferences: true,
  consentKeepText: false,
};

function req(method, body, { origin = ORIGIN, raw } = {}) {
  const h = new Headers();
  if (origin) h.set("origin", origin);
  return new Request(ORIGIN + "/api/profile", {
    method,
    headers: h,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

// A visibly non-plaintext stand-in for the real AES-GCM module (tested in scripts/profile-crypto.test.mjs).
const fakeEncrypt = (id, text, keep) =>
  keep !== true || text === null
    ? null
    : `\\x${Buffer.from(`${id}|${text}`).toString("hex").split("").reverse().join("")}`;
const fakeDecrypt = (id, value) => {
  const plain = Buffer.from(
    value.slice(2).split("").reverse().join(""),
    "hex",
  ).toString();
  if (!plain.startsWith(`${id}|`)) throw new Error("bad");
  return plain.slice(id.length + 1);
};

function deps(over = {}) {
  const calls = {
    writes: [],
    embeds: [],
    deletes: [],
    reads: [],
    decrypts: [],
  };
  const d = {
    getUser: async () => ({ id: A }),
    readProfile: async (id) => {
      calls.reads.push(id);
      return null;
    },
    writeProfile: async (id, patch) => void calls.writes.push([id, patch]),
    deleteProfile: async (id) => void calls.deletes.push(id),
    encrypt: fakeEncrypt,
    decrypt: (id, v) => {
      calls.decrypts.push(id);
      return fakeDecrypt(id, v);
    },
    embed: async (text) => {
      calls.embeds.push(text);
      return EMBEDDING;
    },
    ...over,
  };
  return { d, calls };
}

/** Captures everything written to the console while fn runs. */
async function captureLogs(fn) {
  const seen = [];
  const names = ["log", "info", "warn", "error", "debug"];
  const saved = names.map((n) => console[n]);
  for (const n of names)
    console[n] = (...a) => seen.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    names.forEach((n, i) => (console[n] = saved[i]));
  }
  return seen.join("\n");
}

const put = async (body, d, opts) =>
  handlePutProfile(req("PUT", body, opts), d);

// ---- default feed for empty profiles ----

test("empty and missing fields give a valid default-feed response, not a validation error", async () => {
  for (const body of [
    {
      description: null,
      topics: [],
      consentStorePreferences: false,
      consentKeepText: false,
    },
    { ...BASE, description: "   ", topics: [] },
  ]) {
    const { d, calls } = deps();
    const res = await put(body, d);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(profileResponseSchema.parse(json).feedMode, "default");
    assert.equal(calls.embeds.length, 0);
  }
});

test("a visitor with no session and no consent still gets the default feed and nothing is stored", async () => {
  const { d, calls } = deps({ getUser: async () => null });
  const res = await put({ ...BASE, consentStorePreferences: false }, d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    profile: null,
    safetyState: "normal",
    feedMode: "default",
  });
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.embeds.length, 0, "nothing could use the vector");
});

// ---- input limits ----

test("input limits, unknown keys, bad enums and oversized bodies are 400 without echoing input", async () => {
  const bad = [
    { ...BASE, description: "字".repeat(2001) },
    { ...BASE, topics: Array.from({ length: 13 }, (_, i) => `t${i}`) },
    { ...BASE, topics: ["x".repeat(61)] },
    { ...BASE, ageRange: "teen" },
    { ...BASE, extra: TEXT },
    { ...BASE, consentStorePreferences: false, consentKeepText: true },
    { ...BASE, consentKeepText: "yes" },
  ];
  for (const body of bad) {
    const { d, calls } = deps();
    const res = await put(body, d);
    assert.equal(res.status, 400);
    assert.equal((await res.text()).includes(TEXT), false);
    assert.equal(calls.writes.length + calls.embeds.length, 0);
  }
  const { d } = deps();
  assert.equal((await put(undefined, d, { raw: "{nope" })).status, 400);
  const big = await put(undefined, d, { raw: " ".repeat(17 * 1024) });
  assert.equal(big.status, 400);
  // The limits themselves are accepted.
  const edge = await put(
    {
      ...BASE,
      description: "字".repeat(2000),
      topics: Array(12).fill("x".repeat(60)),
    },
    d,
  );
  assert.equal(edge.status, 200);
});

// ---- consent and storage ----

test("a valid description gives a versioned preference vector and no raw text by default", async () => {
  const { d, calls } = deps();
  const res = await put(BASE, d);
  assert.equal(res.status, 200);
  const json = profileResponseSchema.parse(await res.json());
  assert.equal(json.feedMode, "personalized");
  assert.equal(json.safetyState, "normal");
  assert.equal(json.profile.description, null, "no raw-input echo");
  assert.deepEqual(calls.embeds, [TEXT]);
  const [id, patch] = calls.writes[0];
  assert.equal(id, A);
  assert.equal(patch.preference_embedding, "[0.6,0.8]");
  assert.equal(patch.preference_model_version, "test-model@rev1/exp1");
  assert.equal(patch.description_ciphertext, null);
  assert.equal(JSON.stringify(patch).includes(TEXT), false);
  assert.equal(JSON.stringify(json).includes(TEXT), false);
});

test("the user id comes from the session and never from the request body", async () => {
  const { d, calls } = deps();
  await put({ ...BASE, user_id: "other", userId: "other" }, d); // refused as unknown keys
  assert.equal(calls.writes.length, 0);
  await put(BASE, d);
  assert.equal(calls.writes[0][0], A);
});

test("explicit opt-in keeps only encrypted text; the response confirms what was kept", async () => {
  const { d, calls } = deps();
  const res = await put({ ...BASE, consentKeepText: true }, d);
  const json = await res.json();
  assert.equal(json.profile.description, TEXT); // the visitor's own text, only because they opted in
  const patch = calls.writes[0][1];
  assert.match(patch.description_ciphertext, /^\\x[0-9a-f]+$/);
  assert.equal(JSON.stringify(patch).includes(TEXT), false);
  assert.equal(patch.consent_keep_text, true);
});

test("without opt-in encrypt is never given a chance to keep text, and withdrawing clears it", async () => {
  const { d, calls } = deps();
  await put({ ...BASE, consentKeepText: false }, d);
  assert.equal(calls.writes[0][1].description_ciphertext, null);
  await put({ ...BASE, consentStorePreferences: false }, d);
  assert.deepEqual(calls.writes[1][1], {
    consent_to_personalization: false,
    consent_keep_text: false,
    topics: [],
    preference_embedding: null,
    preference_model_version: null,
    description_ciphertext: null,
  });
});

test("an edit replaces the old vector and text; a null description clears them", async () => {
  const { d, calls } = deps();
  await put({ ...BASE, consentKeepText: true, description: null }, d);
  const patch = calls.writes[0][1];
  assert.equal(patch.preference_embedding, null);
  assert.equal(patch.description_ciphertext, null);
  assert.equal(calls.embeds.length, 0);
});

test("age range and gender are accepted but never stored or used for scoring", async () => {
  const { d, calls } = deps();
  const res = await put({ ...BASE, ageRange: "25-34", gender: "woman" }, d);
  assert.equal(res.status, 200);
  const dump = JSON.stringify(calls.writes) + JSON.stringify(calls.embeds);
  assert.equal(/25-34|woman|age|gender/i.test(dump), false);
  assert.equal(/25-34|woman/.test(JSON.stringify(await res.json())), false);
});

test("topics are stored only with preference consent", () => {
  const none = profileRowPatch(
    { consentStorePreferences: false, consentKeepText: false },
    ["a"],
    EMBEDDING,
    "\\x00",
  );
  assert.deepEqual(none.topics, []);
  assert.equal(none.preference_embedding, null);
  assert.equal(preferenceModelVersion(EMBEDDING), "test-model@rev1/exp1");
});

test("saving preferences needs a session; the text is not processed without one", async () => {
  const { d, calls } = deps({ getUser: async () => null });
  const res = await put(BASE, d);
  assert.equal(res.status, 401);
  assert.equal(calls.embeds.length + calls.writes.length, 0);
});

// ---- safety claims ----

test("the API never claims the description was screened or marks the visitor as needing support", async () => {
  const { d } = deps();
  const json = await (await put({ ...BASE, consentKeepText: true }, d)).json();
  assert.equal(json.safetyState, "normal");
  assert.notEqual(json.feedMode, "support");
  assert.equal(/screen|crisis/i.test(JSON.stringify(json)), false);
});

// ---- failure paths ----

test("a missing ML service gives a recoverable default-feed response and keeps nothing for retry", async () => {
  const { d, calls } = deps({ embed: async () => null });
  const res = await put({ ...BASE, topics: [] }, d);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.feedMode, "default");
  const patch = calls.writes[0][1];
  assert.equal(patch.preference_embedding, null);
  assert.equal(patch.description_ciphertext, null);
  assert.equal(JSON.stringify(calls.writes).includes(TEXT), false);
});

test("a missing encryption key fails closed before the text reaches the ML service or the database", async () => {
  const { d, calls } = deps({
    encrypt: () => {
      throw new Error(`Profile encryption key is unavailable ${TEXT}`);
    },
  });
  let res;
  const logs = await captureLogs(async () => {
    res = await put({ ...BASE, consentKeepText: true }, d);
  });
  assert.equal(res.status, 503);
  assert.equal((await res.text()).includes(TEXT), false);
  assert.equal(logs, "");
  assert.equal(calls.embeds.length + calls.writes.length, 0);
});

test("database and Auth failures return 503 with no text and nothing logged", async () => {
  const boom = () => {
    throw new Error(`insert failed: ${TEXT}`);
  };
  for (const over of [
    { writeProfile: boom },
    { getUser: boom },
    { embed: boom },
  ]) {
    const { d } = deps(over);
    let res;
    const logs = await captureLogs(async () => {
      res = await put(BASE, d);
    });
    assert.equal(res.status, 503);
    assert.equal((await res.text()).includes(TEXT), false);
    assert.equal(logs, "", "handlers do not log");
  }
});

test("a temporary Auth error is not treated as 'no session'", async () => {
  const { d, calls } = deps({
    getUser: async () => {
      throw new Error("Auth check unavailable");
    },
  });
  assert.equal(
    (await put({ ...BASE, consentStorePreferences: false }, d)).status,
    503,
  );
  assert.equal(calls.writes.length, 0);
});

// ---- same-origin ----

test("cross-site mutations are refused before any work", async () => {
  for (const origin of ["https://evil.test", null]) {
    const { d, calls } = deps();
    assert.equal((await put(BASE, d, { origin })).status, 403);
    assert.equal(
      (await handleDeleteProfile(req("DELETE", undefined, { origin }), d))
        .status,
      403,
    );
    assert.equal(
      calls.writes.length + calls.deletes.length + calls.embeds.length,
      0,
    );
  }
});

// ---- retrieval ----

test("authorized retrieval decrypts only the verified user's own retained text", async () => {
  const ciphertext = fakeEncrypt(A, TEXT, true);
  const { d, calls } = deps({
    readProfile: async () => ({
      consent_to_personalization: true,
      consent_keep_text: true,
      topics: ["感恩"],
      has_preference: true,
      description_ciphertext: ciphertext,
    }),
  });
  const res = await handleGetProfile(d);
  const json = profileResponseSchema.parse(await res.json());
  assert.equal(json.profile.description, TEXT);
  assert.equal(json.feedMode, "personalized");
  assert.deepEqual(calls.decrypts, [A]);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("retrieval without a session or without opt-in never decrypts and returns no text", async () => {
  const none = deps({ getUser: async () => null });
  assert.deepEqual(await (await handleGetProfile(none.d)).json(), {
    profile: null,
    safetyState: "normal",
    feedMode: "default",
  });
  assert.equal(none.calls.reads.length, 0);

  const noKeep = deps({
    readProfile: async () => ({
      consent_to_personalization: true,
      consent_keep_text: false,
      topics: [],
      has_preference: false,
      description_ciphertext: fakeEncrypt(A, TEXT, true), // would be refused by the database
    }),
  });
  const json = await (await handleGetProfile(noKeep.d)).json();
  assert.equal(json.profile.description, null);
  assert.equal(noKeep.calls.decrypts.length, 0);
  assert.equal(json.feedMode, "default");

  const withdrawn = deps({
    readProfile: async () => ({
      consent_to_personalization: false,
      consent_keep_text: false,
      topics: [],
      has_preference: false,
      description_ciphertext: null,
    }),
  });
  assert.equal(
    (await (await handleGetProfile(withdrawn.d)).json()).profile,
    null,
  );
});

test("retrieval fails closed when the key is missing or the data cannot be decrypted", async () => {
  const { d } = deps({
    readProfile: async () => ({
      consent_to_personalization: true,
      consent_keep_text: true,
      topics: [],
      has_preference: false,
      description_ciphertext: "\\x00",
    }),
    decrypt: () => {
      throw new Error("Profile encryption key is unavailable");
    },
  });
  let res;
  const logs = await captureLogs(async () => {
    res = await handleGetProfile(d);
  });
  assert.equal(res.status, 503);
  assert.equal(logs, "");
});

test("a temporary Auth failure on read is 503, not an empty profile", async () => {
  const { d } = deps({
    getUser: async () => {
      throw new Error("Auth check unavailable");
    },
  });
  assert.equal((await handleGetProfile(d)).status, 503);
});

// ---- deletion ----

test("deleting the profile removes the owner's row and is idempotent", async () => {
  const { d, calls } = deps();
  for (let i = 0; i < 2; i++) {
    const res = await handleDeleteProfile(req("DELETE"), d);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  }
  assert.deepEqual(calls.deletes, [A, A]);
});

test("deleting needs a session and reports failures without detail", async () => {
  const anon = deps({ getUser: async () => null });
  assert.equal((await handleDeleteProfile(req("DELETE"), anon.d)).status, 401);
  assert.equal(anon.calls.deletes.length, 0);
  const { d } = deps({
    deleteProfile: async () => {
      throw new Error(TEXT);
    },
  });
  const res = await handleDeleteProfile(req("DELETE"), d);
  assert.equal(res.status, 503);
  assert.equal((await res.text()).includes(TEXT), false);
});
