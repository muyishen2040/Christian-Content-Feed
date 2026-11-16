import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";

import {
  decryptProfileDescription,
  encryptProfileDescription,
} from "../lib/profile-crypto.ts";

const originalKey = process.env.PROFILE_DESCRIPTION_KEY;
const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000b2";
const fictionalText = "這是一個虛構的例子。";
const key = randomBytes(32).toString("base64");

after(() => {
  if (originalKey === undefined) delete process.env.PROFILE_DESCRIPTION_KEY;
  else process.env.PROFILE_DESCRIPTION_KEY = originalKey;
});

test("only explicit consent allows storage", () => {
  delete process.env.PROFILE_DESCRIPTION_KEY;
  assert.equal(encryptProfileDescription(userA, fictionalText, false), null);
  assert.equal(encryptProfileDescription(userA, null, true), null);
  assert.throws(() => encryptProfileDescription(userA, fictionalText, true));
});

test("encrypts with fresh nonces and recovers text for the correct user", () => {
  process.env.PROFILE_DESCRIPTION_KEY = key;
  const first = encryptProfileDescription(userA, fictionalText, true);
  const second = encryptProfileDescription(userA, fictionalText, true);
  assert.notEqual(first, second);
  assert.match(first, /^\\x[0-9a-f]+$/);
  assert.equal(
    Buffer.from(first.slice(2), "hex").includes(Buffer.from(fictionalText)),
    false,
  );
  assert.equal(decryptProfileDescription(userA, first), fictionalText);
  assert.throws(
    () => decryptProfileDescription(userB, first),
    /Could not decrypt/,
  );
});

test("rejects tampering, malformed inputs and invalid keys", () => {
  process.env.PROFILE_DESCRIPTION_KEY = key;
  const ciphertext = encryptProfileDescription(userA, fictionalText, true);
  const last = ciphertext.at(-1);
  const tampered = ciphertext.slice(0, -1) + (last === "0" ? "1" : "0");
  assert.throws(
    () => decryptProfileDescription(userA, tampered),
    /Could not decrypt/,
  );
  assert.throws(
    () => decryptProfileDescription(userA, "\\x00"),
    /Invalid encrypted/,
  );
  assert.throws(() =>
    encryptProfileDescription("not-a-uuid", fictionalText, true),
  );
  assert.throws(() => encryptProfileDescription(userA, "x".repeat(2001), true));
  process.env.PROFILE_DESCRIPTION_KEY = randomBytes(32).toString("base64");
  assert.throws(
    () => decryptProfileDescription(userA, ciphertext),
    /Could not decrypt/,
  );
  process.env.PROFILE_DESCRIPTION_KEY = "not-a-key";
  assert.throws(() => encryptProfileDescription(userA, fictionalText, true));
});
