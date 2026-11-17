import type { ReconciliationDirection, ReconciliationIssueKind } from "@birr/db";
import type { PaystackRefundRecord, PaystackTransactionRecord, PaystackTransferRecord } from "../../common/payments/paystack-reports.client";

/**
 * The pure part of reconciliation: given what Paystack lists and what Birr
 * recorded, which mismatches are there. No database, no Paystack calls, so
 * every rule can be tested on its own. Amounts are in kobo throughout.
 *
 * Paystack is read for the day ±1 day, but only records from the day itself
 * are judged: a payment started at 23:59 that Paystack logs at 00:01 is
 * still found, not reported missing.
 */

export interface Window {
  start: Date;
  end: Date;
}

/** A payment into Birr, from any product. */
export interface BirrPayment {
  product: "waqf_contribution" | "vault_contribution" | "zakah_payment" | "clinic_gift";
  id: string;
  reference: string;
  status: "pending" | "confirmed" | "failed";
  /** What Paystack should have taken: for zakah and clinic gifts, the amount plus the fee cover. */
  amountKobo: number;
  currency: string;
  createdAt: Date;
}

/** A payout from Birr's Paystack balance. */
export interface BirrPayout {
  product: "waqf_distribution" | "vault_distribution";
  id: string;
  reference: string;
  status: string;
  amountKobo: number;
  currency: string;
  /** When it was last touched (sent, paid, failed). */
  activityAt: Date;
}

/** A Vault gift Birr has refunded, or started refunding, through Paystack. */
export interface BirrRefund {
  id: string;
  /** The original payment's reference and Paystack id. */
  paymentReference: string;
  paymentProviderId: string | null;
  refundStatus: string;
  amountKobo: number;
  currency: string;
  activityAt: Date;
}

export interface IssueDraft {
  direction: ReconciliationDirection;
  kind: ReconciliationIssueKind;
  providerReference: string;
  product: string | null;
  recordId: string | null;
  paystackStatus: string | null;
  paystackAmountKobo: number | null;
  birrStatus: string | null;
  birrAmountKobo: number | null;
  currency: string | null;
  detail: string;
}

const within = (date: Date, w: Window) => date >= w.start && date < w.end;
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PRODUCT_LABEL: Record<string, string> = {
  waqf_contribution: "Waqf contribution",
  vault_contribution: "Vault gift",
  zakah_payment: "Zakah payment",
  clinic_gift: "Clinic waqf gift",
  waqf_distribution: "Waqf distribution",
  vault_distribution: "Vault distribution",
  vault_refund: "Vault refund",
};

export function compareMoneyIn(paystack: PaystackTransactionRecord[], birr: BirrPayment[], window: Window): IssueDraft[] {
  const issues: IssueDraft[] = [];
  const birrByRef = new Map(birr.map((b) => [b.reference, b]));
  const paystackByRef = new Map(paystack.map((p) => [p.reference, p]));
  const flagged = new Set<string>();

  for (const p of paystack) {
    if (p.status !== "success" || !within(p.createdAt, window)) continue;
    const b = birrByRef.get(p.reference);
    const base = { direction: "in" as const, providerReference: p.reference, paystackStatus: p.status, paystackAmountKobo: p.amount, currency: p.currency };
    if (!b) {
      issues.push({ ...base, kind: "in_missing_in_birr", product: null, recordId: null, birrStatus: null, birrAmountKobo: null, detail: `Paystack took ${naira(p.amount)} that Birr has no record of.` });
      flagged.add(p.reference);
      continue;
    }
    const known = { product: b.product, recordId: b.id, birrStatus: b.status, birrAmountKobo: b.amountKobo };
    if (b.status !== "confirmed") {
      issues.push({ ...base, ...known, kind: "in_status_mismatch", detail: `${PRODUCT_LABEL[b.product]} paid at Paystack, but Birr shows it ${b.status}.` });
      flagged.add(p.reference);
    } else if (b.amountKobo !== p.amount || b.currency !== p.currency) {
      issues.push({ ...base, ...known, kind: "in_amount_mismatch", detail: `${PRODUCT_LABEL[b.product]}: Paystack took ${naira(p.amount)}, Birr recorded ${naira(b.amountKobo)}.` });
      flagged.add(p.reference);
    }
  }

  for (const b of birr) {
    if (b.status !== "confirmed" || !within(b.createdAt, window) || flagged.has(b.reference)) continue;
    const p = paystackByRef.get(b.reference);
    const known = { direction: "in" as const, providerReference: b.reference, product: b.product, recordId: b.id, birrStatus: b.status, birrAmountKobo: b.amountKobo, currency: b.currency };
    if (!p) {
      issues.push({ ...known, kind: "in_missing_at_paystack", paystackStatus: null, paystackAmountKobo: null, detail: `${PRODUCT_LABEL[b.product]} of ${naira(b.amountKobo)} is confirmed at Birr, but Paystack has no such payment.` });
    } else if (p.status !== "success") {
      issues.push({ ...known, kind: "in_status_mismatch", paystackStatus: p.status, paystackAmountKobo: p.amount, detail: `${PRODUCT_LABEL[b.product]} is confirmed at Birr, but Paystack shows it ${p.status}.` });
    }
  }
  return issues;
}

/** Transfer statuses where money has left, or may yet leave, Birr's balance. */
const TRANSFER_LIVE = new Set(["success", "pending", "processing", "otp", "received", "queued"]);

export function compareMoneyOut(paystack: PaystackTransferRecord[], birr: BirrPayout[], window: Window): IssueDraft[] {
  const issues: IssueDraft[] = [];
  const birrByRef = new Map(birr.map((b) => [b.reference, b]));
  const paystackByRef = new Map(paystack.map((p) => [p.reference, p]));
  const flagged = new Set<string>();

  for (const p of paystack) {
    if (!within(p.createdAt, window)) continue;
    const b = birrByRef.get(p.reference);
    const base = { direction: "out" as const, providerReference: p.reference, paystackStatus: p.status, paystackAmountKobo: p.amount, currency: p.currency };
    if (!b) {
      if (TRANSFER_LIVE.has(p.status)) {
        issues.push({ ...base, kind: "out_missing_in_birr", product: null, recordId: null, birrStatus: null, birrAmountKobo: null, detail: `Paystack sent a ${naira(p.amount)} transfer (${p.status}) that Birr has no record of.` });
        flagged.add(p.reference);
      }
      continue;
    }
    const known = { product: b.product, recordId: b.id, birrStatus: b.status, birrAmountKobo: b.amountKobo };
    if (p.status === "success" && b.status !== "paid") {
      issues.push({ ...base, ...known, kind: "out_status_mismatch", detail: `${PRODUCT_LABEL[b.product]} was paid out by Paystack, but Birr shows it ${b.status}.` });
      flagged.add(p.reference);
    } else if ((p.status === "failed" || p.status === "reversed") && b.status === "paid") {
      issues.push({ ...base, ...known, kind: "out_status_mismatch", detail: `${PRODUCT_LABEL[b.product]} shows paid at Birr, but Paystack's transfer ${p.status}.` });
      flagged.add(p.reference);
    } else if (b.amountKobo !== p.amount || b.currency !== p.currency) {
      issues.push({ ...base, ...known, kind: "out_amount_mismatch", detail: `${PRODUCT_LABEL[b.product]}: Paystack sent ${naira(p.amount)}, Birr recorded ${naira(b.amountKobo)}.` });
      flagged.add(p.reference);
    }
  }

  for (const b of birr) {
    if (!within(b.activityAt, window) || flagged.has(b.reference)) continue;
    if (b.status !== "paid" && b.status !== "disbursing") continue;
    if (!paystackByRef.has(b.reference)) {
      issues.push({
        direction: "out",
        kind: "out_missing_at_paystack",
        providerReference: b.reference,
        product: b.product,
        recordId: b.id,
        paystackStatus: null,
        paystackAmountKobo: null,
        birrStatus: b.status,
        birrAmountKobo: b.amountKobo,
        currency: b.currency,
        detail: `${PRODUCT_LABEL[b.product]} of ${naira(b.amountKobo)} shows ${b.status} at Birr, but Paystack has no such transfer.`,
      });
    }
  }
  return issues;
}

/** Refund statuses where money has gone back, or is going back, to the giver. */
const REFUND_LIVE = new Set(["processed", "pending", "processing", "needs-attention"]);

export function compareRefunds(paystack: PaystackRefundRecord[], birr: BirrRefund[], payments: Map<string, string>, window: Window): IssueDraft[] {
  // `payments`: Paystack payment id → our reference, for refunds Paystack
  // lists by payment id only.
  const issues: IssueDraft[] = [];
  const birrByRef = new Map(birr.map((b) => [b.paymentReference, b]));
  const seenRefs = new Set<string>();

  for (const p of paystack) {
    if (!within(p.createdAt, window) || !REFUND_LIVE.has(p.status)) continue;
    const reference = p.transactionReference ?? (p.transactionId != null ? (payments.get(String(p.transactionId)) ?? null) : null);
    const label = reference ?? `Paystack payment ${p.transactionId ?? "unknown"}`;
    if (reference) seenRefs.add(reference);
    const b = reference ? birrByRef.get(reference) : undefined;
    if (!b) {
      issues.push({
        direction: "refund",
        kind: "refund_missing_in_birr",
        providerReference: label,
        product: null,
        recordId: null,
        paystackStatus: p.status,
        paystackAmountKobo: p.amount,
        birrStatus: null,
        birrAmountKobo: null,
        currency: p.currency,
        detail: `Paystack refunded ${naira(p.amount)} of payment ${label}, which Birr hasn't recorded as refunded.`,
      });
    }
  }

  for (const b of birr) {
    if (!within(b.activityAt, window) || b.refundStatus !== "refunded" || seenRefs.has(b.paymentReference)) continue;
    issues.push({
      direction: "refund",
      kind: "refund_missing_at_paystack",
      providerReference: b.paymentReference,
      product: "vault_refund",
      recordId: b.id,
      paystackStatus: null,
      paystackAmountKobo: null,
      birrStatus: b.refundStatus,
      birrAmountKobo: b.amountKobo,
      currency: b.currency,
      detail: `Vault gift of ${naira(b.amountKobo)} shows refunded at Birr, but Paystack has no refund for it.`,
    });
  }
  return issues;
}
