import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { SettingsService } from "../../../common/settings/settings.service";
import { renderEmailTemplate } from "../../../common/email/notification-template";
import { inRealDeployment, logDevEmailFallback } from "../../../common/email/dev-send-fallback";

export interface RecurringGiftEmail {
  to: string;
  subject: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/**
 * Monthly-giving emails (set up, reminders, failed or paused charges,
 * cancellation). A direct transactional send, like
 * ResendVaultReceiptEmailAdapter: Vault and zakah givers have no account
 * or in-app inbox. Same lazy client and dev fallback.
 */
@Injectable()
export class ResendRecurringGiftEmailAdapter {
  private client: Resend | undefined;
  private cachedApiKey: string | undefined;

  constructor(private readonly settings: SettingsService) {}

  async send(email: RecurringGiftEmail): Promise<void> {
    const apiKey = await this.settings.get("resend", "API_KEY");
    const from = await this.settings.get("resend", "FROM_ADDRESS");
    if (!apiKey || !from) {
      if (inRealDeployment()) {
        throw new Error(apiKey ? "Resend from-address is not configured." : "Resend API key is not configured.");
      }
      logDevEmailFallback("monthly giving", email.to, `${email.subject}\n${email.bodyHtml}${email.ctaUrl ? `\n${email.ctaUrl}` : ""}`);
      return;
    }
    if (!this.client || apiKey !== this.cachedApiKey) {
      this.client = new Resend(apiKey);
      this.cachedApiKey = apiKey;
    }
    const { error } = await this.client.emails.send({
      from,
      to: email.to,
      subject: email.subject,
      html: renderEmailTemplate({ heading: email.heading, bodyHtml: email.bodyHtml, ctaLabel: email.ctaLabel, ctaUrl: email.ctaUrl }),
    });
    if (error) throw new Error(`Resend rejected a monthly-giving email: ${error.message}`);
  }
}
