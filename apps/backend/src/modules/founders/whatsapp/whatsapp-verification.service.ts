import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { assertUserEmailVerified } from "../../../common/auth/current-founder";
import { WhatsAppOtpService } from "../../../common/whatsapp/whatsapp-otp.service";

/**
 * Step 1b of onboarding — WhatsApp number verification, alongside email
 * (step 1a). User-keyed, not Founder-keyed: at this point in the flow
 * no Founder exists yet (that's step 2 now), so this operates directly
 * on the session User, no FounderMembership indirection needed.
 *
 * A thin wrapper around the generic WhatsAppOtpService (common/whatsapp)
 * — the only thing specific to founders here is the onboarding-order
 * gate (email must be verified first, step 1a before step 1b). See
 * BirrStaffWhatsAppService for the equivalent staff-side wrapper, which
 * has no such gate.
 */
@Injectable()
export class WhatsAppVerificationService {
  constructor(private readonly core: WhatsAppOtpService) {}

  async requestOtp(userId: string, whatsappNumber: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Unknown account.");
    // Email must come first — WhatsApp verification is step 1b, not 1a.
    assertUserEmailVerified(user);
    return this.core.requestOtp(userId, whatsappNumber);
  }

  async verifyOtp(userId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Unknown account.");
    assertUserEmailVerified(user);
    return this.core.verifyOtp(userId, code, "founder_user");
  }
}
