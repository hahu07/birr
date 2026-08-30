import { Injectable } from "@nestjs/common";
import { WhatsAppOtpService } from "../../../common/whatsapp/whatsapp-otp.service";

/**
 * Staff-side counterpart to founders/whatsapp/whatsapp-verification.service.ts
 * — same generic WhatsAppOtpService underneath, no onboarding-order gate
 * (a staff member verifies their number any time from their own profile,
 * not as a fixed step in a wizard). Exists so a Birr officer can actually
 * receive a WhatsApp notification (see the notifications module) — until
 * this, no BirrStaff account had a verified number at all.
 */
@Injectable()
export class BirrStaffWhatsAppService {
  constructor(private readonly core: WhatsAppOtpService) {}

  requestOtp(userId: string, whatsappNumber: string) {
    return this.core.requestOtp(userId, whatsappNumber);
  }

  verifyOtp(userId: string, code: string) {
    return this.core.verifyOtp(userId, code, "birr_staff");
  }
}
