import { Injectable } from "@nestjs/common";
import { Twilio } from "twilio";
import { WhatsAppOtpAdapter } from "./whatsapp-otp.adapter";
import { SettingsService } from "../settings/settings.service";
import { TWILIO_SANDBOX_NUMBER, WHATSAPP_TEMPLATES, templateValue, type WhatsAppTemplateKey } from "./whatsapp-templates";

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

  private async sender(): Promise<string> {
    const from = await this.settings.get("twilio", "WHATSAPP_FROM_NUMBER");
    if (!from) {
      throw new Error("Twilio WhatsApp from-number is not configured.");
    }
    return from;
  }

  /**
   * Sends one kind of message (2026-11-16). With the template's approved
   * content SID set in Platform Settings, Twilio sends that template with
   * these values. Without one, the free text goes instead — which only
   * reaches people from the sandbox sender, so on a real sender a missing
   * template is refused here with a clear reason rather than by WhatsApp.
   */
  async sendTemplate(to: string, template: WhatsAppTemplateKey, values: string[], fallbackText: string): Promise<void> {
    const from = await this.sender();
    const contentSid = await this.settings.get("twilio", WHATSAPP_TEMPLATES[template].setting);
    const twilio = await this.getTwilio();
    if (contentSid) {
      const contentVariables = JSON.stringify(Object.fromEntries(values.map((v, i) => [String(i + 1), templateValue(v)])));
      await twilio.messages.create({ from: `whatsapp:${from}`, to: `whatsapp:${to}`, contentSid, contentVariables });
      return;
    }
    if (from.replace(/\s/g, "") !== TWILIO_SANDBOX_NUMBER) {
      throw new Error(
        `No approved WhatsApp template for "${template}": add its content SID in Platform Settings → Twilio (see docs/whatsapp-templates.md).`,
      );
    }
    await twilio.messages.create({ from: `whatsapp:${from}`, to: `whatsapp:${to}`, body: fallbackText });
  }

  sendOtp(to: string, code: string): Promise<void> {
    return this.sendTemplate(to, "verification_code", [code], `Your Birr verification code is ${code}. It expires in 10 minutes.`);
  }
}
