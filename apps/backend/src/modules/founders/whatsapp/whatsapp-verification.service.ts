import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomInt } from "crypto";
import { prisma } from "@birr/db";
import { assertUserEmailVerified } from "../../../common/auth/current-founder";
import { TwilioWhatsAppAdapter } from "./twilio-whatsapp.adapter";

const OTP_VALIDITY_MINUTES = 10;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function hashCode(code: string, userId: string): string {
  return createHash("sha256").update(`${code}${userId}`).digest("hex");
}

/**
 * Step 1b of onboarding — WhatsApp number verification, alongside email
 * (step 1a). User-keyed, not Founder-keyed: at this point in the flow
 * no Founder exists yet (that's step 2 now), so this operates directly
 * on the session User, no FounderMembership indirection needed. Kept as
 * its own service rather than folded into FoundersService, same
 * reasoning that split the payment adapters from ContributionsService:
 * the OTP hashing/attempt-limiting logic here is substantial enough to
 * warrant its own file.
 */
@Injectable()
export class WhatsAppVerificationService {
  constructor(private readonly otpAdapter: TwilioWhatsAppAdapter) {}

  async requestOtp(userId: string, whatsappNumber: string) {
    if (!E164_PATTERN.test(whatsappNumber)) {
      throw new BadRequestException("Enter a valid WhatsApp number in international format, e.g. +15551234567.");
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Unknown account.");
    // Email must come first — WhatsApp verification is step 1b, not 1a.
    assertUserEmailVerified(user);

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

  async verifyOtp(userId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Unknown account.");
    assertUserEmailVerified(user);

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
          actorType: "founder_user",
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
