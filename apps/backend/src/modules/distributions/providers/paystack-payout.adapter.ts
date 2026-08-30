import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  CreatePayoutInput,
  CreatePayoutResult,
  PayoutProviderAdapter,
  PayoutWebhookResult,
} from "./payout-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";
import { verifyPaystackSignature } from "../../../common/payments/verify-paystack-signature";

interface PaystackRecipientResponse {
  status: boolean;
  data?: { recipient_code: string };
  message?: string;
}

interface PaystackTransferResponse {
  status: boolean;
  message?: string;
}

interface PaystackTransferWebhookEvent {
  event: string;
  data: { reference: string };
}

/**
 * Real, working payout rail — the only one of the three PayoutProvider
 * adapters that actually moves money (see PayoutProvider's own schema
 * comment). Two Paystack calls per payout: create a transfer recipient,
 * then initiate the transfer against it. Uses the same
 * PAYSTACK_SECRET_KEY as the inbound contributions/providers/paystack
 * .adapter.ts — one Paystack secret key covers both their Transactions
 * and Transfers APIs, no separate setting needed.
 *
 * Fresh recipient created on every call, not cached — simplest correct
 * behavior for a first pass. Costs one extra HTTP round-trip per payout
 * to a beneficiary paid more than once; not a correctness bug, just a
 * known inefficiency. A future pass could cache recipient_code on
 * Beneficiary, keyed by a hash of its bank details, invalidated on edit.
 *
 * GO-LIVE PREREQUISITE: Birr's own Paystack dashboard must have
 * "Require OTP for transfers" disabled, or an API-initiated transfer
 * will get stuck needing manual OTP finalization
 * (POST /transfer/finalize_transfer) — a code path this adapter does
 * not implement. This is an account-configuration decision for Birr to
 * make on Paystack's side, not something this code controls.
 */
@Injectable()
export class PaystackPayoutAdapter implements PayoutProviderAdapter {
  readonly provider = "paystack" as const;
  private readonly baseUrl = "https://api.paystack.co";

  constructor(private readonly settings: SettingsService) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!secretKey) {
      throw new ServiceUnavailableException("Payouts via Paystack aren't available right now.");
    }
    if (!input.bankDetails.bankCode) {
      // Defense in depth — DistributionsService.assertPayoutReady should
      // already have blocked this before initiateDisbursement ever calls
      // createPayout.
      throw new BadRequestException("Beneficiary bank details are missing a bank code.");
    }

    // Same minor-unit assumption as the inbound adapter (kobo for NGN).
    const amountMinorUnits = Math.round(Number(input.amount) * 100);

    const recipientRes = await fetch(`${this.baseUrl}/transferrecipient`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "nuban",
        name: input.bankDetails.accountName,
        account_number: input.bankDetails.accountNumber,
        bank_code: input.bankDetails.bankCode,
        currency: input.currency.toUpperCase(),
      }),
    });
    const recipientBody = (await recipientRes.json()) as PaystackRecipientResponse;
    if (!recipientRes.ok || !recipientBody.status || !recipientBody.data?.recipient_code) {
      throw new Error(`Paystack transfer recipient creation failed: ${recipientBody.message ?? recipientRes.statusText}`);
    }

    const transferRes = await fetch(`${this.baseUrl}/transfer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "balance",
        amount: amountMinorUnits,
        recipient: recipientBody.data.recipient_code,
        reason: "Waqf distribution",
        reference: input.reference,
      }),
    });
    const transferBody = (await transferRes.json()) as PaystackTransferResponse;
    if (!transferRes.ok || !transferBody.status) {
      throw new Error(`Paystack transfer initiation failed: ${transferBody.message ?? transferRes.statusText}`);
    }

    return { providerReference: input.reference };
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<PayoutWebhookResult | null> {
    const signature = headers["x-paystack-signature"];
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!verifyPaystackSignature(rawBody, signature, secretKey)) return null;

    let event: PaystackTransferWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }

    if (event.event === "transfer.success") {
      return { providerReference: event.data.reference, status: "paid" };
    }
    if (event.event === "transfer.failed" || event.event === "transfer.reversed") {
      return { providerReference: event.data.reference, status: "failed" };
    }
    // Not a transfer event (e.g. a charge.* event) — signature-valid but
    // out of this adapter's family. Return null so the caller falls
    // through to the inbound-charge parser instead.
    return null;
  }
}
