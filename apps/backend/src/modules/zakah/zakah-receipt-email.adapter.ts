import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { SettingsService } from "../../common/settings/settings.service";
import { renderEmailTemplate } from "../../common/email/notification-template";
import { inRealDeployment, logDevEmailFallback } from "../../common/email/dev-send-fallback";

export interface ZakahReceipt {
  to: string;
  amount: string;
  feeCover: string;
  paymentId: string;
}

function naira(amount: string): string {
  return `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A zakah payer's receipt — their record that the obligation was paid.
 * Same direct, one-off Resend send as ResendVaultReceiptEmailAdapter (a
 * payer has no account or in-app inbox), including its fallback of
 * logging the email outside a real deployment.
 */
@Injectable()
export class ResendZakahReceiptEmailAdapter {
  private client: Resend | undefined;
  private cachedApiKey: string | undefined;

  constructor(private readonly settings: SettingsService) {}

  async sendReceipt(input: ZakahReceipt): Promise<void> {
    const apiKey = await this.settings.get("resend", "API_KEY");
    const from = await this.settings.get("resend", "FROM_ADDRESS");

    const feeLine =
      Number(input.feeCover) > 0
        ? `<p>You also added ${naira(input.feeCover)} to cover the processing fee, so your zakah reaches recipients in full.</p>`
        : "";
    const bodyHtml =
      `<p>We've received your zakah of <strong>${naira(input.amount)}</strong>.</p>` +
      `<p>As your agent, Birr will pass it on only to people eligible to receive zakah. None of it is used for Birr's own running costs.</p>` +
      feeLine +
      `<p>Keep this email as your record. Reference: ${input.paymentId}</p>`;

    if (!apiKey || !from) {
      if (inRealDeployment()) {
        throw new Error(apiKey ? "Resend from-address is not configured." : "Resend API key is not configured.");
      }
      logDevEmailFallback("zakah payment receipt", input.to, bodyHtml);
      return;
    }

    if (!this.client || apiKey !== this.cachedApiKey) {
      this.client = new Resend(apiKey);
      this.cachedApiKey = apiKey;
    }
    const { error } = await this.client.emails.send({
      from,
      to: input.to,
      subject: "Your zakah payment to Birr",
      html: renderEmailTemplate({ heading: "Your zakah has been received", bodyHtml }),
    });
    if (error) throw new Error(`Resend rejected the zakah receipt: ${error.message}`);
  }
}
