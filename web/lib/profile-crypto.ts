import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 1;
const MAX_TEXT_LENGTH = 2000;
const MAX_ENVELOPE_BYTES = 1 + NONCE_LENGTH + TAG_LENGTH + MAX_TEXT_LENGTH * 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encryptionKey(): Buffer {
  const encoded = process.env.PROFILE_DESCRIPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("Profile encryption key is unavailable");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_LENGTH || key.toString("base64") !== encoded) {
    throw new Error("Profile encryption key is unavailable");
  }
  return key;
}

function additionalData(userId: string): Buffer {
  if (!UUID.test(userId)) throw new Error("Invalid profile identifier");
  return Buffer.from(`profile-description:v1:${userId.toLowerCase()}`, "utf8");
}

/** Encrypt only with explicit consent; authenticate the user before calling. */
export function encryptProfileDescription(
  userId: string,
  description: string | null,
  consentToKeepText: boolean,
): string | null {
  if (consentToKeepText !== true || description === null) return null;
  if (typeof description !== "string" || description.length > MAX_TEXT_LENGTH) {
    throw new Error("Invalid profile description");
  }
  const aad = additionalData(userId);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([
    cipher.update(description, "utf8"),
    cipher.final(),
  ]);
  const envelope = Buffer.concat([
    Buffer.from([VERSION]),
    nonce,
    cipher.getAuthTag(),
    encrypted,
  ]);
  return `\\x${envelope.toString("hex")}`;
}

/** The caller must check session ownership before decrypting. */
export function decryptProfileDescription(
  userId: string,
  value: string,
): string {
  if (
    value.length > 2 + MAX_ENVELOPE_BYTES * 2 ||
    !/^\\x(?:[0-9a-f]{2})+$/i.test(value)
  ) {
    throw new Error("Invalid encrypted profile description");
  }
  const data = Buffer.from(value.slice(2), "hex");
  if (data.length < 1 + NONCE_LENGTH + TAG_LENGTH || data[0] !== VERSION) {
    throw new Error("Invalid encrypted profile description");
  }
  const aad = additionalData(userId);
  const key = encryptionKey();
  try {
    const nonce = data.subarray(1, 1 + NONCE_LENGTH);
    const tag = data.subarray(1 + NONCE_LENGTH, 1 + NONCE_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(1 + NONCE_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt profile description");
  }
}
