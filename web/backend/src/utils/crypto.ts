import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "./env.js";

// AES-256-GCM encryption for storing plaintext votes at rest.
// Format: base64(iv || ciphertext || authTag)

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
const KEY_LEN = 32;

function loadKey(): Buffer {
  const raw = env.VOTE_ENCRYPTION_KEY;
  if (!raw) throw new Error("VOTE_ENCRYPTION_KEY is not configured");
  // Accept hex (64 chars) or base64 (44 chars)
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== KEY_LEN) {
    throw new Error(`VOTE_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${key.length})`);
  }
  return key;
}

export function encryptVoteSalt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

export function decryptVoteSalt(payload: string): string {
  const key = loadKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - 16);
  const enc = buf.subarray(IV_LEN, buf.length - 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
