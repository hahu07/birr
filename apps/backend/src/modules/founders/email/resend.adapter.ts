import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { VerificationEmailAdapter } from "./verification-email.adapter";
import { SettingsService } from "../../../common/settings/settings.service";
import { renderEmailTemplate } from "../../../common/email/notification-template";
import { inRealDeployment, logDevEmailFallback } from "../../../common/email/dev-send-fallback";

/**
 * Lazy client construction, same reasoning as StripeAdapter — the Resend
 * SDK doesn't throw on an empty key at construction time, but calling it
 * would still fail confusingly; failing fast with a clear message only
 * when a send is actually attempted keeps the backend bootable with the
 * key unset. Re-checks SettingsService.get() every call and rebuilds the
 * client if the key changed since the last call — a key set via the
 * Platform Settings dashboard must take effect without a restart.
 */
@Injectable()
export class ResendVerificationEmailAdapter implements VerificationEmailAdapter {
  private client: Resend | undefined;
  private cachedApiKey: string | undefined;

  constructor(private readonly settings: SettingsService) {}

  private async getResend(apiKey: string): Promise<Resend> {
    if (!this.client || apiKey !== this.cachedApiKey) {
      this.client = new Resend(apiKey);
      this.cachedApiKey = apiKey;
    }
    return this.client;
  }

  async sendVerificationEmail(to: string, link: string): Promise<void> {
    const apiKey = await this.settings.get("resend", "API_KEY");
    const from = await this.settings.get("resend", "FROM_ADDRESS");

    // See dev-send-fallback.ts's own comment — a real deployment still
    // fails loudly (unchanged from before this fallback existed);
    // outside one, log the link a real email would have carried rather
    // than blocking local development on live Resend credentials.
    if (!apiKey || !from) {
      if (inRealDeployment()) {
        throw new Error(apiKey ? "Resend from-address is not configured." : "Resend API key is not configured.");
      }
      logDevEmailFallback("verification email", to, `Verify email: ${link}`);
      return;
    }

    const resend = await this.getResend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Verify your Birr Founder account",
      html: renderEmailTemplate({
        heading: "Welcome to Birr",
        bodyHtml:
          "<p>Confirm your email to activate your Founder account and begin establishing your Foundation. " +
          "This link expires in 24 hours.</p>",
        ctaLabel: "Verify email",
        ctaUrl: link,
      }),
    });
    if (error) {
      throw new Error(`Resend rejected the verification email: ${error.message}`);
    }
  }
}
