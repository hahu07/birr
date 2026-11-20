import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import { SettingsService } from "../../common/settings/settings.service";
import { renderEmailTemplate } from "../../common/email/notification-template";
import { inRealDeployment, logDevEmailFallback } from "../../common/email/dev-send-fallback";
import type { WaqfProgrammeProduct } from "@birr/db";
import { WAQF_PROGRAMME_PRODUCTS } from "@birr/shared";

export interface ProgrammeGiftReceipt {
  to: string;
  clinicName: string;
  product: WaqfProgrammeProduct;
  pot: "endowment" | "running";
  amount: string;
  feeCover: string;
  giftId: string;
  /** Endowment gifts: the deed version the giver accepted. */
  deedVersion?: number | null;
}

// What each pot does, per product, for the receipt. Kifayah launches giving
// first, so it says support starts later, with no figure.
const POT_PURPOSE: Record<WaqfProgrammeProduct, { endowment: string; running: string }> = {
  clinic: {
    endowment: "its income pays for the clinic's care of women and children.",
    running: "It pays for subsidised visits and the clinic's running costs.",
  },
  need_based: {
    endowment: "its income helps poor households reach sufficiency, by their own means, once support starts.",
    running: "It pays for support for poor households: living support, tools and stock, training and coaching. Support starts once Kifayah's financing partner and kifayah line are in place.",
  },
};

// The programme's name is set by staff; escape it like any text put into HTML.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function naira(amount: string): string {
  return `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A waqf programme gift's receipt (2026-11-17; worded per product since
 * need-based NB2). Same direct, one-off Resend send as the zakah and Vault
 * receipts (a giver has no account), including logging the email outside a
 * real deployment.
 */
@Injectable()
export class ResendProgrammeReceiptEmailAdapter {
  private client: Resend | undefined;
  private cachedApiKey: string | undefined;

  constructor(private readonly settings: SettingsService) {}

  async sendReceipt(input: ProgrammeGiftReceipt): Promise<void> {
    const apiKey = await this.settings.get("resend", "API_KEY");
    const from = await this.settings.get("resend", "FROM_ADDRESS");

    const purpose = POT_PURPOSE[input.product];
    const potName = WAQF_PROGRAMME_PRODUCTS[input.product].potLabels[input.pot].toLowerCase();
    const what =
      input.pot === "endowment"
        ? `<p>We've received your gift of <strong>${naira(input.amount)}</strong> to the ${potName} of ${escapeHtml(input.clinicName)}.</p>` +
          `<p>It's endowed for ever: it is never spent, and ${purpose.endowment}` +
          (input.deedVersion ? ` You gave it under version ${input.deedVersion} of the waqf's deed.` : "") +
          `</p>`
        : `<p>We've received your gift of <strong>${naira(input.amount)}</strong> to the ${potName} of ${escapeHtml(input.clinicName)}.</p>` +
          `<p>${purpose.running}</p>`;
    const feeLine =
      Number(input.feeCover) > 0
        ? `<p>You also added ${naira(input.feeCover)} to cover the processing fee, so your gift arrives in full.</p>`
        : `<p>Birr pays the processing fee, so your gift arrives in full.</p>`;
    const bodyHtml = what + feeLine + `<p>Keep this email as your record. Reference: ${input.giftId}</p>`;

    if (!apiKey || !from) {
      if (inRealDeployment()) {
        throw new Error(apiKey ? "Resend from-address is not configured." : "Resend API key is not configured.");
      }
      logDevEmailFallback("clinic gift receipt", input.to, bodyHtml);
      return;
    }

    if (!this.client || apiKey !== this.cachedApiKey) {
      this.client = new Resend(apiKey);
      this.cachedApiKey = apiKey;
    }
    const { error } = await this.client.emails.send({
      from,
      to: input.to,
      subject: `Your gift to ${input.clinicName}`,
      html: renderEmailTemplate({ heading: "Thank you for your gift", bodyHtml }),
    });
    if (error) throw new Error(`Resend rejected the clinic gift receipt: ${error.message}`);
  }
}
