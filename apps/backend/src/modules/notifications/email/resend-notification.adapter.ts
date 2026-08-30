import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { renderEmailTemplate } from "../../../common/email/notification-template";
import { SettingsService } from "../../../common/settings/settings.service";

// Same lazy-client / SettingsService-first pattern as
// founders/email/resend.adapter.ts and
// invitations/email/resend-invitation.adapter.ts — the third of three
// Resend adapters in this codebase, all sharing renderEmailTemplate for
// a consistent look, kept as separate small classes (not one shared
// base) for the same reason the other two are separate: each sends
// genuinely different content to a genuinely different trigger, and the
// only actually-shared logic (client construction) is a few lines.
@Injectable()
export class ResendNotificationEmailAdapter {
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

  async sendNotificationEmail(
    to: string,
    input: { title: string; body: string; linkUrl?: string },
  ): Promise<void> {
    const from = await this.settings.get("resend", "FROM_ADDRESS");
    if (!from) {
      throw new Error("Resend from-address is not configured.");
    }
    const resend = await this.getResend();
    const { error } = await resend.emails.send({
      from,
      to,
      subject: input.title,
      html: renderEmailTemplate({
        heading: input.title,
        bodyHtml: `<p>${escapeHtml(input.body)}</p>`,
        ctaLabel: input.linkUrl ? "View in Birr" : undefined,
        ctaUrl: input.linkUrl,
      }),
    });
    if (error) {
      throw new Error(`Resend rejected the notification email: ${error.message}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
