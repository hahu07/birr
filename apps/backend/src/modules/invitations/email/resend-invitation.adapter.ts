import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { InvitationEmailAdapter, InvitationEmailContext } from "./invitation-email.adapter";
import { SettingsService } from "../../../common/settings/settings.service";
import { renderEmailTemplate } from "../../../common/email/notification-template";

// Same lazy-client / SettingsService-first pattern as
// founders/email/resend.adapter.ts — not consolidated into one shared
// class since the two send genuinely different content to different
// audiences (a self-service sign-up confirming their own email vs. a
// staff- or founder-initiated invite for someone else), but the
// underlying "how do we get a working Resend client" logic is
// identical, so this mirrors that file's structure exactly.
@Injectable()
export class ResendInvitationEmailAdapter implements InvitationEmailAdapter {
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

  async sendInvitationEmail(to: string, link: string, context: InvitationEmailContext): Promise<void> {
    const from = await this.settings.get("resend", "FROM_ADDRESS");
    if (!from) {
      throw new Error("Resend from-address is not configured.");
    }
    const resend = await this.getResend();
    const surface = context.inviteeKind === "birr_staff" ? "Birr's Ops Console" : "the Birr Founder Portal";
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "You've been invited to Birr",
      html: renderEmailTemplate({
        heading: "You're invited to Birr",
        bodyHtml: `<p>${context.invitedByName} has invited you to join ${surface} as ${context.roleLabel}. This link expires in 7 days.</p>`,
        ctaLabel: "Accept invitation",
        ctaUrl: link,
      }),
    });
    if (error) {
      throw new Error(`Resend rejected the invitation email: ${error.message}`);
    }
  }
}
