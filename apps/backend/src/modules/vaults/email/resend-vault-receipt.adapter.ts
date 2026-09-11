import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { VaultReceiptEmailAdapter } from "./vault-receipt-email.adapter";
import { SettingsService } from "../../../common/settings/settings.service";
import { renderEmailTemplate } from "../../../common/email/notification-template";
import { inRealDeployment, logDevEmailFallback } from "../../../common/email/dev-send-fallback";

/**
 * Same lazy-client/re-check-every-call pattern as
 * ResendVerificationEmailAdapter — see that file's own comment. A
 * VaultDonor has no session/in-app inbox to show this in (unlike a
 * Founder's notifications, which go through NotificationsService and its
 * required recipientUserId — a VaultDonor is deliberately not a User
 * row), so this is a direct, one-off transactional send, not routed
 * through that in-app-notification machinery at all.
 */
@Injectable()
export class ResendVaultReceiptEmailAdapter implements VaultReceiptEmailAdapter {
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

  async sendReceipt(input: {
    to: string;
    vaultName: string;
    causeName?: string;
    amount: string;
    currency: string;
    contributionId: string;
  }): Promise<void> {
    const apiKey = await this.settings.get("resend", "API_KEY");
    const from = await this.settings.get("resend", "FROM_ADDRESS");

    const bodyHtml = `<p>Thank you for your donation of <strong>${input.currency} ${input.amount}</strong> to <strong>${input.vaultName}</strong>${
      input.causeName ? ` (earmarked for ${input.causeName})` : ""
    }.</p><p>Reference: ${input.contributionId}</p>`;

    // See dev-send-fallback.ts's own comment — a real deployment still
    // fails loudly; outside one, log what would have been sent instead
    // of blocking local development on live Resend credentials.
    if (!apiKey || !from) {
      if (inRealDeployment()) {
        throw new Error(apiKey ? "Resend from-address is not configured." : "Resend API key is not configured.");
      }
      logDevEmailFallback("vault contribution receipt", input.to, bodyHtml);
      return;
    }

    const resend = await this.getResend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: `Your donation to ${input.vaultName}`,
      html: renderEmailTemplate({ heading: "Thank you for your donation", bodyHtml }),
    });
    if (error) {
      throw new Error(`Resend rejected the vault contribution receipt: ${error.message}`);
    }
  }
}
