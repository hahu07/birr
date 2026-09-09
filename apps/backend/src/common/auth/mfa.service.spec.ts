import { MfaService } from "./mfa.service";

describe("MfaService", () => {
  const service = new MfaService();

  test("generateSecret() returns a base32 secret and a matching otpauth:// URI", () => {
    const { secretBase32, otpauthUri } = service.generateSecret("checker@example.com");
    expect(secretBase32).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(otpauthUri).toContain(secretBase32);
  });

  test("verifyCode() accepts a code generated from the same secret", async () => {
    const OTPAuth = await import("otpauth");
    const { secretBase32 } = service.generateSecret("checker@example.com");
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const code = totp.generate();
    expect(service.verifyCode(secretBase32, code)).toBe(true);
  });

  test("verifyCode() rejects a code from a different secret", () => {
    const { secretBase32 } = service.generateSecret("checker@example.com");
    expect(service.verifyCode(secretBase32, "000000")).toBe(false);
  });

  test("generateBackupCodes() returns the requested count of distinct codes", () => {
    const codes = service.generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  test("hashBackupCodes()/compareBackupCode() round-trip correctly", async () => {
    const [code] = service.generateBackupCodes(1);
    const [hashed] = await service.hashBackupCodes([code!]);
    await expect(service.compareBackupCode(code!, hashed!)).resolves.toBe(true);
    await expect(service.compareBackupCode("wrong-code", hashed!)).resolves.toBe(false);
  });

  // Explicit timeout: real PNG QR generation comfortably exceeds Jest's
  // 5s default once a loaded/virtualized runner is running this
  // alongside ~50 other test files in parallel — confirmed repeatedly,
  // not a hang. Same reasoning as birr-staff.service.spec.ts's own
  // explicit timeouts on its MFA tests, which hit this same cost via
  // startMfaEnrollment().
  test(
    "qrCodeDataUrl() returns a PNG data URL",
    async () => {
      const { otpauthUri } = service.generateSecret("checker@example.com");
      const dataUrl = await service.qrCodeDataUrl(otpauthUri);
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    },
    20000,
  );
});
