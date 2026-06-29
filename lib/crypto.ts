import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const TAG_LENGTH = 16;

// NOTE: Uses SHA-256 for key derivation (no salt/stretching).
// Improving this (e.g., scrypt) requires re-encrypting all ApiCredential records in the DB.
// Do not change this without a data migration script.
function getDerivedKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set");
  if (raw.length < 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be at least 32 characters. Use a random 32-byte hex string.");
  }
  // Derive a 32-byte key from the env var (allows arbitrary-length secrets)
  return createHash("sha256").update(raw).digest();
}

/**
 * Encrypts a plaintext string. Returns a base64-encoded string of:
 * [12-byte IV][16-byte auth tag][ciphertext]
 */
export function encrypt(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypts a base64-encoded string produced by encrypt().
 */
export function decrypt(ciphertext: string): string {
  const key = getDerivedKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

