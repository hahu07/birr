import { describe, expect, it } from "vitest";
import { Decimal } from "./internal";
import { processingFeeCover } from "./fees";

// Paystack's fee on a total, as the payer would be charged.
function feeOn(total: string): Decimal {
  const t = new Decimal(total);
  const fee = t.times("0.015").plus(t.lessThan(2500) ? 0 : 100);
  return Decimal.min(fee, 2000);
}

describe("processingFeeCover", () => {
  it.each(["1000", "2400", "2500", "95000", "29750.01", "131000", "3000000"])(
    "covers Paystack's fee on the whole charge for ₦%s",
    (amount) => {
      const cover = processingFeeCover(amount);
      const total = new Decimal(amount).plus(cover);
      expect(new Decimal(cover).greaterThanOrEqualTo(feeOn(total.toString()))).toBe(true);
      // And by no more than a kobo or so — the payer isn't overcharged.
      expect(new Decimal(cover).minus(feeOn(total.toString())).lessThanOrEqualTo("0.02")).toBe(true);
    },
  );

  it("adds about 1.5% plus ₦100 on Amina's ₦95,000", () => {
    // c = 1.5% × (95,000 + c) + 100, so c = 1,525 ÷ 0.985 = ₦1,548.22…, rounded up.
    expect(processingFeeCover("95000")).toBe("1548.23");
  });

  it("never adds more than the ₦2,000 cap", () => {
    expect(processingFeeCover("3000000")).toBe("2000.00");
  });

  it("rejects an amount that isn't a positive decimal string", () => {
    expect(() => processingFeeCover("0")).toThrow(expect.objectContaining({ field: "amount" }));
    expect(() => processingFeeCover("-5")).toThrow(expect.objectContaining({ field: "amount" }));
  });
});
