import { Injectable } from "@nestjs/common";
import { Twilio } from "twilio";
import { WhatsAppOtpAdapter } from "./whatsapp-otp.adapter";
import { SettingsService } from "../settings/settings.service";

/**
 * Lazy client construction, same reasoning as StripeAdapter/
 * ResendVerificationEmailAdapter — constructing the Twilio client with
 * empty credentials shouldn't crash the whole backend at boot (Nest
 * instantiates every provider eagerly), only fail clearly the first time
 * an OTP is actually sent. Sandbox/test mode only until Birr is ready to
 * go live, which is a business decision, not something this adapter
 * enforces. Re-checks SettingsService.get() every call and rebuilds the
 * client if credentials changed since the last call — values set via
 * the Platform Settings dashboard must take effect without a restart.
 *
 * Lives under common/, not a specific feature module — Founders
 * (onboarding step 1b), Birr staff (profile WhatsApp verification), and
 * NotificationsService (arbitrary WhatsApp notifications, once a
 * number's verified) all share this same adapter.
 */
@Injectable()
export class TwilioWhatsAppAdapter implements WhatsAppOtpAdapter {
  private client: Twilio | undefined;
  private cachedSid: string | undefined;

  constructor(private readonly settings: SettingsService) {}

  private async getTwilio(): Promise<Twilio> {
    const sid = await this.settings.get("twilio", "ACCOUNT_SID");
    const token = await this.settings.get("twilio", "AUTH_TOKEN");
    if (!sid || !token) {
      throw new Error("Twilio account SID/auth token are not configured.");
    }
    if (!this.client || sid !== this.cachedSid) {
      this.client = new Twilio(sid, token);
      this.cachedSid = sid;
    }
    return this.client;
  }

  private async send(to: string, body: string): Promise<void> {
    const from = await this.settings.get("twilio", "WHATSAPP_FROM_NUMBER");
    if (!from) {
      throw new Error("Twilio WhatsApp from-number is not configured.");
    }
    const twilio = await this.getTwilio();
    await twilio.messages.create({ from: `whatsapp:${from}`, to: `whatsapp:${to}`, body });
  }

  sendOtp(to: string, code: string): Promise<void> {
    return this.send(to, `Your Birr verification code is ${code}. It expires in 10 minutes.`);
  }

  /** Arbitrary WhatsApp text — used by NotificationsService, never for OTP. */
  sendMessage(to: string, body: string): Promise<void> {
    return this.send(to, body);
  }
}
