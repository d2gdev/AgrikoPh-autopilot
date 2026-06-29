import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

const TEST_KEY = "test-secret-key-for-unit-tests-only";

beforeEach(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
});

describe("encrypt / decrypt", () => {
  it("roundtrip: decrypt(encrypt(plaintext)) returns original string", () => {
    const plaintext = "Hello, Agriko! ₱1,234.56";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("encrypted output is different from plaintext", () => {
    const plaintext = "sensitive-credential-value";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
  });

  it("different calls produce different ciphertext (random IV)", () => {
    const plaintext = "same input";
    const ct1 = encrypt(plaintext);
    const ct2 = encrypt(plaintext);
    expect(ct1).not.toBe(ct2);
    // But both must decrypt correctly
    expect(decrypt(ct1)).toBe(plaintext);
    expect(decrypt(ct2)).toBe(plaintext);
  });

  it("tampered ciphertext throws on decrypt (GCM auth tag validation)", () => {
    const plaintext = "do not tamper";
    const ciphertext = encrypt(plaintext);

    // Flip a byte in the middle of the base64 payload (past the IV+tag header)
    const buf = Buffer.from(ciphertext, "base64");
    // Tamper a byte in the ciphertext portion (after 28-byte IV+tag header)
    buf[30] = (buf[30] ?? 0) ^ 0xff;
    const tampered = buf.toString("base64");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is not set", () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encrypt("anything")).toThrow("CREDENTIALS_ENCRYPTION_KEY is not set");
  });

  it("handles empty string plaintext", () => {
    const plaintext = "";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("handles unicode and special characters", () => {
    const plaintext = "₱ peso sign • émojis 🌾 and\nnewlines\ttabs";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });
});
