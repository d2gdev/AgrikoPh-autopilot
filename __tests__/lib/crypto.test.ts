import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

describe("encrypt/decrypt", () => {
  beforeAll(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = "test-secret-key-for-unit-tests-only";
  });

  afterAll(() => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  });

  it("round-trips a plaintext string", () => {
    const plain = "my-secret-api-key";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plain = "same-input";
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  it("decrypts correctly regardless of IV variance", () => {
    const plain = "consistent-value";
    const ct1 = encrypt(plain);
    const ct2 = encrypt(plain);
    expect(decrypt(ct1)).toBe(plain);
    expect(decrypt(ct2)).toBe(plain);
  });

  it("throws on tampered ciphertext", () => {
    const ct = encrypt("secret");
    const buf = Buffer.from(ct, "base64");
    // byte 30 = ciphertext[2], past the 12-byte IV + 16-byte auth tag header
    buf[30] = (buf[30] ?? 0) ^ 0xff;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is not set", () => {
    const original = process.env.CREDENTIALS_ENCRYPTION_KEY;
    try {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      expect(() => encrypt("test")).toThrow("CREDENTIALS_ENCRYPTION_KEY is not set");
    } finally {
      process.env.CREDENTIALS_ENCRYPTION_KEY = original;
    }
  });
});
