import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomInt } from "crypto";
import { prisma, ActorType } from "@birr/db";
import { TwilioWhatsAppAdapter } from "./twilio-whatsapp.adapter";

const OTP_VALIDITY_MINUTES = 10;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function hashCode(code: string, userId: string): string {
  return createHash("sha256").update(`${code}${userId}`).digest("hex");
}

/**
 * The generic WhatsApp-number-verification core — request/hash/rate-limit/
 * verify against WhatsAppOtp, send via TwilioWhatsAppAdapter. User-keyed,
 * not Founder- or BirrStaff-keyed: `User` is the shared account table
 * both identity types sit on top of, so this has no opinion about who's
 * calling or what has to be true first.
 *
 * Deliberately carries no business-rule gate of its own (no "must have
 * verified email first," no "must be mid-onboarding") — that's each
 * caller's own concern. FoundersService's WhatsAppVerificationService
 * wraps this with the onboarding-step-1b gate; BirrStaffWhatsAppService
 * wraps it with none at all (a signed-in staff member can verify their
 * number any time from their profile). Splitting it this way once,
 * instead of duplicating the hash/attempt-limit/OTP-row logic per
 * caller, is the whole point of this file existing.
 */
@Injectable()
export class WhatsAppOtpService {
  constructor(private readonly otpAdapter: TwilioWhatsAppAdapter) {}

  async requestOtp(userId: string, whatsappNumber: string): Promise<{ sent: true }> {
    if (!E164_PATTERN.test(whatsappNumber)) {
      throw new BadRequestException("Enter a valid WhatsApp number in international format, e.g. +15551234567.");
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Unknown account.");

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = hashCode(code, user.id);
    const expiresAt = new Date(Date.now() + OTP_VALIDITY_MINUTES * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { whatsappNumber } });
      await tx.whatsAppOtp.create({
        data: { userId: user.id, phoneNumber: whatsappNumber, codeHash, expiresAt },
      });
    });

    // Deliberately outside the transaction, same precedent as
    // FoundersService.signUp()'s email send — the OTP row and the
    // unverified phone number stay recorded even if delivery fails, so a
    // resend can reuse them without recreating any state.
    try {
      await this.otpAdapter.sendOtp(whatsappNumber, code);
    } catch (err) {
      throw new BadRequestException(
        `Could not send the WhatsApp verification code: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    return { sent: true };
  }

  async verifyOtp(userId: string, code: string, actorType: ActorType): Promise<{ userId: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Unknown account.");

    const otp = await prisma.whatsAppOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) {
      throw new NotFoundException("No pending verification code found — request a new one.");
    }
    if (otp.expiresAt < new Date()) {
      throw new BadRequestException("This code has expired — request a new one.");
    }
    if (otp.attempts >= otp.maxAttempts) {
      throw new ForbiddenException("Too many incorrect attempts — request a new code.");
    }

    if (hashCode(code, user.id) !== otp.codeHash) {
      const attempts = otp.attempts + 1;
      await prisma.whatsAppOtp.update({ where: { id: otp.id }, data: { attempts } });
      const remaining = otp.maxAttempts - attempts;
      throw new BadRequestException(
        remaining > 0
          ? `Incorrect code, ${remaining} attempt(s) remaining.`
          : "Incorrect code. Too many incorrect attempts — request a new code.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.whatsAppOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { whatsappVerifiedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorType,
          actorUserId: user.id,
          action: "user.whatsapp_verified",
          entityType: "User",
          entityId: user.id,
        },
      });
    });

    return { userId };
  }
}
