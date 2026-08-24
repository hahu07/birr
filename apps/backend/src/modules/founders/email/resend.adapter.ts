import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { VerificationEmailAdapter } from "./verification-email.adapter";
import { SettingsService } from "../../../common/settings/settings.service";

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

  private async getResend(): Promise<Resend> {
    const apiKey = await this.settings.get("resend", "API_KEY");
    if (!apiKey) {
      throw new Error("Resend API key is not configured.");
    }
    if (!this.client || apiKey !== this.cachedApiKey) {
      this.client = new Resend(apiKey);
      this.cachedApiKey = apiKey;
    }
    return this.client;
  }

  async sendVerificationEmail(to: string, link: string): Promise<void> {
    const from = await this.settings.get("resend", "FROM_ADDRESS");
    if (!from) {
      throw new Error("Resend from-address is not configured.");
    }
    const resend = await this.getResend();
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Verify your Birr Founder account",
      html: `
        <p>Welcome to Birr.</p>
        <p>Confirm your email to activate your Founder account and begin establishing your Foundation:</p>
        <p><a href="${link}">${link}</a></p>
        <p>This link expires in 24 hours. If you didn't request this, you can ignore this email.</p>
      `,
    });
    if (error) {
      throw new Error(`Resend rejected the verification email: ${error.message}`);
    }
  }
}
