import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { WhatsAppVerificationService } from "./whatsapp-verification.service";
import { WhatsAppOtpAdapter } from "../../../common/whatsapp/whatsapp-otp.adapter";
import { WhatsAppOtpService } from "../../../common/whatsapp/whatsapp-otp.service";

class FakeOtpAdapter implements WhatsAppOtpAdapter {
  lastCode: string | null = null;
  shouldFail = false;

  async sendOtp(_to: string, code: string): Promise<void> {
    if (this.shouldFail) throw new Error("simulated delivery failure");
    this.lastCode = code;
  }
}

describe("WhatsAppVerificationService", () => {
  const fakeAdapter = new FakeOtpAdapter();
  const core = new WhatsAppOtpService(fakeAdapter as any);
  const service = new WhatsAppVerificationService(core);

  // User-keyed, not Founder-keyed — at this point in onboarding no
  // Founder exists yet (that's step 2, after WhatsApp verification).
  async function createEmailVerifiedUser() {
    return prisma.user.create({
      data: {
        email: `whatsapp-spec-${Date.now()}-${Math.random()}@example.test`,
        fullName: "Verified Contact",
        status: "active",
      },
    });
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("requestOtp() rejects an invalid phone number", async () => {
    const user = await createEmailVerifiedUser();
    await expect(service.requestOtp(user.id, "not-a-number")).rejects.toThrow(BadRequestException);
  });

  test("requestOtp() rejects when the user hasn't verified email yet", async () => {
    const user = await prisma.user.create({
      data: { email: `whatsapp-spec-unverified-${Date.now()}@example.test`, fullName: "Unverified Contact" },
    });
    await expect(service.requestOtp(user.id, "+15551234567")).rejects.toThrow(ForbiddenException);
  });

  test("happy path: request -> verify -> whatsappVerifiedAt set + audit log written", async () => {
    const user = await createEmailVerifiedUser();
    fakeAdapter.shouldFail = false;

    await service.requestOtp(user.id, "+15551234567");
    expect(fakeAdapter.lastCode).not.toBeNull();

    const result = await service.verifyOtp(user.id, fakeAdapter.lastCode!);
    expect(result.userId).toBe(user.id);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.whatsappVerifiedAt).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: user.id, action: "user.whatsapp_verified" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorUserId: user.id });
  });

  test("verifyOtp() rejects a wrong code and increments attempts", async () => {
    const user = await createEmailVerifiedUser();
    await service.requestOtp(user.id, "+15551234567");

    await expect(service.verifyOtp(user.id, "000000")).rejects.toThrow(BadRequestException);

    const otp = await prisma.whatsAppOtp.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    expect(otp?.attempts).toBe(1);
  });

  test("verifyOtp() locks out after maxAttempts incorrect attempts", async () => {
    const user = await createEmailVerifiedUser();
    await service.requestOtp(user.id, "+15551234567");

    for (let i = 0; i < 5; i++) {
      await expect(service.verifyOtp(user.id, "000000")).rejects.toThrow(BadRequestException);
    }
    // 6th attempt: attempts already at maxAttempts, should now be a lockout (Forbidden), not a BadRequest.
    await expect(service.verifyOtp(user.id, "000000")).rejects.toThrow(ForbiddenException);
  });

  test("verifyOtp() rejects an expired code", async () => {
    const user = await createEmailVerifiedUser();
    await service.requestOtp(user.id, "+15551234567");

    const otp = await prisma.whatsAppOtp.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    await prisma.whatsAppOtp.update({ where: { id: otp!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(service.verifyOtp(user.id, fakeAdapter.lastCode!)).rejects.toThrow(BadRequestException);
  });

  test("verifyOtp() rejects when no OTP was ever requested", async () => {
    const user = await createEmailVerifiedUser();
    await expect(service.verifyOtp(user.id, "123456")).rejects.toThrow(NotFoundException);
  });
});
