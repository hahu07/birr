import { EncryptionService } from "./encryption.service";

describe("EncryptionService", () => {
  const service = new EncryptionService();

  test("encrypt() then decrypt() round-trips the original plaintext", () => {
    const plaintext = "sk_test_super_secret_value_123";
    const packed = service.encrypt(plaintext);
    expect(packed).not.toContain(plaintext);
    expect(service.decrypt(packed)).toBe(plaintext);
  });

  test("encrypt() produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-plaintext";
    const a = service.encrypt(plaintext);
    const b = service.encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe(plaintext);
    expect(service.decrypt(b)).toBe(plaintext);
  });

  test("decrypt() rejects a tampered ciphertext (auth tag mismatch)", () => {
    const packed = service.encrypt("original-value");
    const [iv, authTag, ciphertext] = packed.split(".");
    const tamperedCiphertext = Buffer.from(ciphertext!, "base64");
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;
    const tampered = [iv, authTag, tamperedCiphertext.toString("base64")].join(".");
    expect(() => service.decrypt(tampered)).toThrow();
  });

  test("decrypt() rejects a malformed packed value", () => {
    expect(() => service.decrypt("not-a-valid-packed-value")).toThrow("Malformed encrypted value.");
  });

  test("throws a clear error when SETTINGS_ENCRYPTION_KEY is unset", () => {
    const original = process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    try {
      expect(() => service.encrypt("anything")).toThrow("SETTINGS_ENCRYPTION_KEY is not configured.");
    } finally {
      process.env.SETTINGS_ENCRYPTION_KEY = original;
    }
  });
});
