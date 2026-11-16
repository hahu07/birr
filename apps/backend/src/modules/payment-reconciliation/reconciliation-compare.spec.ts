import { compareMoneyIn, compareMoneyOut, compareRefunds, type BirrPayment, type BirrPayout, type BirrRefund } from "./reconciliation-compare";
import { lagosDay, windowForDay } from "./payment-reconciliation.service";

const window = windowForDay("2026-11-15");
const during = new Date("2026-11-15T10:00:00Z");
const dayBefore = new Date("2026-11-14T10:00:00Z");

const pay = (reference: string, over: Partial<BirrPayment> = {}): BirrPayment => ({
  product: "vault_contribution",
  id: `row-${reference}`,
  reference,
  status: "confirmed",
  amountKobo: 25_000_000,
  currency: "NGN",
  createdAt: during,
  ...over,
});
const tx = (reference: string, over: Partial<{ status: string; amount: number; createdAt: Date; id: number }> = {}) => ({
  id: over.id ?? 1,
  reference,
  status: over.status ?? "success",
  amount: over.amount ?? 25_000_000,
  currency: "NGN",
  createdAt: over.createdAt ?? during,
});

describe("reconciliation windows (Lagos days)", () => {
  test("a Lagos day starts at 23:00 UTC the day before", () => {
    expect(window.start.toISOString()).toBe("2026-11-14T23:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-15T23:00:00.000Z");
    expect(lagosDay(new Date("2026-11-14T23:30:00Z"))).toBe("2026-11-15");
  });
});

describe("money in", () => {
  test("matching records on both sides: nothing to flag", () => {
    expect(compareMoneyIn([tx("A")], [pay("A")], window)).toEqual([]);
  });

  test("Paystack took a payment Birr has no record of", () => {
    expect(compareMoneyIn([tx("A")], [], window)).toMatchObject([{ kind: "in_missing_in_birr", direction: "in", providerReference: "A", paystackAmountKobo: 25_000_000, product: null }]);
  });

  test("Birr shows confirmed, Paystack has nothing", () => {
    expect(compareMoneyIn([], [pay("A")], window)).toMatchObject([{ kind: "in_missing_at_paystack", recordId: "row-A", birrStatus: "confirmed" }]);
  });

  test("paid at Paystack but pending at Birr, and the reverse", () => {
    expect(compareMoneyIn([tx("A")], [pay("A", { status: "pending" })], window)).toMatchObject([{ kind: "in_status_mismatch", birrStatus: "pending", paystackStatus: "success" }]);
    expect(compareMoneyIn([tx("A", { status: "reversed" })], [pay("A")], window)).toMatchObject([{ kind: "in_status_mismatch", paystackStatus: "reversed" }]);
  });

  test("different amounts", () => {
    expect(compareMoneyIn([tx("A", { amount: 24_000_000 })], [pay("A")], window)).toMatchObject([{ kind: "in_amount_mismatch" }]);
  });

  test("an abandoned checkout pending at both ends isn't a mismatch", () => {
    expect(compareMoneyIn([tx("A", { status: "abandoned" })], [pay("A", { status: "pending" })], window)).toEqual([]);
  });

  test("a payment logged by Paystack just after midnight is still found, and other days aren't judged", () => {
    const justAfter = new Date(window.end.getTime() + 60_000);
    expect(compareMoneyIn([tx("A", { createdAt: justAfter })], [pay("A")], window)).toEqual([]);
    expect(compareMoneyIn([tx("B", { createdAt: dayBefore })], [], window)).toEqual([]);
    expect(compareMoneyIn([], [pay("C", { createdAt: dayBefore })], window)).toEqual([]);
  });
});

describe("money out", () => {
  const payout = (reference: string, over: Partial<BirrPayout> = {}): BirrPayout => ({
    product: "waqf_distribution",
    id: `dist-${reference}`,
    reference,
    status: "paid",
    amountKobo: 5_000_000,
    currency: "NGN",
    activityAt: during,
    ...over,
  });
  const transfer = (reference: string, status = "success", amount = 5_000_000) => ({ reference, status, amount, currency: "NGN", createdAt: during });

  test("matching transfer: nothing to flag", () => {
    expect(compareMoneyOut([transfer("T")], [payout("T")], window)).toEqual([]);
  });

  test("a transfer Birr has no record of is flagged; a failed one Birr never knew of isn't", () => {
    expect(compareMoneyOut([transfer("T")], [], window)).toMatchObject([{ kind: "out_missing_in_birr", direction: "out" }]);
    expect(compareMoneyOut([transfer("T", "failed")], [], window)).toEqual([]);
  });

  test("Birr shows paid with no transfer at Paystack", () => {
    expect(compareMoneyOut([], [payout("T")], window)).toMatchObject([{ kind: "out_missing_at_paystack", recordId: "dist-T" }]);
  });

  test("status and amount mismatches", () => {
    expect(compareMoneyOut([transfer("T")], [payout("T", { status: "disbursing" })], window)).toMatchObject([{ kind: "out_status_mismatch" }]);
    expect(compareMoneyOut([transfer("T", "reversed")], [payout("T")], window)).toMatchObject([{ kind: "out_status_mismatch" }]);
    expect(compareMoneyOut([transfer("T", "success", 4_000_000)], [payout("T")], window)).toMatchObject([{ kind: "out_amount_mismatch" }]);
  });
});

describe("refunds", () => {
  const refund = (over: Partial<BirrRefund> = {}): BirrRefund => ({
    id: "gift-1",
    paymentReference: "P",
    paymentProviderId: "77",
    refundStatus: "refunded",
    amountKobo: 25_000_000,
    currency: "NGN",
    activityAt: during,
    ...over,
  });
  const paystackRefund = (over: Partial<{ transactionReference: string | null; transactionId: number | null; status: string }> = {}) => ({
    transactionReference: "P",
    transactionId: 77,
    status: "processed",
    amount: 25_000_000,
    currency: "NGN",
    createdAt: during,
    ...over,
  });

  test("a recorded refund Paystack also made: nothing to flag, matched by reference or by payment id", () => {
    expect(compareRefunds([paystackRefund()], [refund()], new Map(), window)).toEqual([]);
    expect(compareRefunds([paystackRefund({ transactionReference: null })], [refund()], new Map([["77", "P"]]), window)).toEqual([]);
  });

  test("Paystack refunded something Birr hasn't recorded", () => {
    expect(compareRefunds([paystackRefund()], [], new Map(), window)).toMatchObject([{ kind: "refund_missing_in_birr", providerReference: "P" }]);
  });

  test("Birr shows refunded, Paystack has no refund", () => {
    expect(compareRefunds([], [refund()], new Map(), window)).toMatchObject([{ kind: "refund_missing_at_paystack", product: "vault_refund" }]);
  });
});
