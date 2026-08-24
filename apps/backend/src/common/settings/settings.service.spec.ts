import { BadRequestException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { EncryptionService } from "./encryption.service";
import { SettingsService } from "./settings.service";

describe("SettingsService", () => {
  const service = new SettingsService(new EncryptionService());
  let userId: string;

  beforeAll(async () => {
    // Fixture User not cleaned up in afterAll — same reasoning as every
    // other spec in this codebase: it ends up referenced via
    // audit_logs.actorUserId, and that table is insert-only at the DB
    // role level.
    const user = await prisma.user.create({
      data: { email: `settings-spec-${Date.now()}@example.test`, fullName: "Settings Spec Staff" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.providerCredential.deleteMany({ where: { provider: "stripe", key: "SECRET_KEY" } });
    await prisma.$disconnect();
  });

  test("get() falls back to the env var when no DB row exists", async () => {
    const original = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_from_env";
    try {
      await expect(service.get("stripe", "SECRET_KEY")).resolves.toBe("sk_test_from_env");
    } finally {
      process.env.STRIPE_SECRET_KEY = original;
    }
  });

  test("set() then get() returns the DB value, overriding the env var", async () => {
    const originalEnv = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_from_env";
    try {
      await service.set("stripe", "SECRET_KEY", "sk_test_from_dashboard", userId);
      await expect(service.get("stripe", "SECRET_KEY")).resolves.toBe("sk_test_from_dashboard");
    } finally {
      process.env.STRIPE_SECRET_KEY = originalEnv;
    }
  });

  test("set() rejects an unknown provider/key pair", async () => {
    await expect(service.set("not-a-real-provider", "NOT_A_REAL_KEY", "value", userId)).rejects.toThrow(
      BadRequestException,
    );
  });

  test("set() writes an audit log that never contains the plaintext value", async () => {
    await service.set("stripe", "SECRET_KEY", "sk_test_should_never_appear_in_audit_log", userId);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "ProviderCredential", entityId: "stripe.SECRET_KEY", action: "provider_credential.updated" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
    const serialized = JSON.stringify(logs[0]);
    expect(serialized).not.toContain("sk_test_should_never_appear_in_audit_log");
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: userId });
  });

  test("getStatus() reports configured:false before set(), configured:true with a masked preview after", async () => {
    await prisma.providerCredential.deleteMany({ where: { provider: "resend", key: "API_KEY" } });
    const before = await service.getStatus("resend", "API_KEY");
    expect(before).toMatchObject({ configured: false, maskedPreview: null });

    await service.set("resend", "API_KEY", "re_abcdefgh1234WXYZ", userId);
    const after = await service.getStatus("resend", "API_KEY");
    expect(after.configured).toBe(true);
    expect(after.maskedPreview).not.toBeNull();
    expect(after.maskedPreview).not.toContain("re_abcdefgh1234WXYZ");
    expect(after.maskedPreview!.endsWith("WXYZ")).toBe(true);
    expect(after.updatedByUser).toMatchObject({ id: userId });

    await prisma.providerCredential.deleteMany({ where: { provider: "resend", key: "API_KEY" } });
  });

  test("getStatus() does not fall back to the env var — only reflects what's actually in the DB", async () => {
    await prisma.providerCredential.deleteMany({ where: { provider: "twilio", key: "AUTH_TOKEN" } });
    const original = process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_AUTH_TOKEN = "env-configured-token";
    try {
      const status = await service.getStatus("twilio", "AUTH_TOKEN");
      expect(status.configured).toBe(false);
    } finally {
      process.env.TWILIO_AUTH_TOKEN = original;
    }
  });

  test("clear() removes the DB override, reverting get() to the env fallback, and audit-logs the change", async () => {
    const originalEnv = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = "sk_test_env_fallback";
    try {
      await service.set("paystack", "SECRET_KEY", "sk_test_dashboard_value", userId);
      await expect(service.get("paystack", "SECRET_KEY")).resolves.toBe("sk_test_dashboard_value");

      await service.clear("paystack", "SECRET_KEY", userId);
      await expect(service.get("paystack", "SECRET_KEY")).resolves.toBe("sk_test_env_fallback");

      const logs = await prisma.auditLog.findMany({
        where: { entityType: "ProviderCredential", entityId: "paystack.SECRET_KEY", action: "provider_credential.cleared" },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    } finally {
      process.env.PAYSTACK_SECRET_KEY = originalEnv;
      await prisma.providerCredential.deleteMany({ where: { provider: "paystack", key: "SECRET_KEY" } });
    }
  });
});
