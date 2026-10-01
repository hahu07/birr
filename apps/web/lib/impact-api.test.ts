import { describe, expect, it } from "vitest";
import { formatCompactMoney, impactMinGifts, splitCurrencies, visibleImpact, type ImpactSummary } from "./impact-api";

describe("formatCompactMoney", () => {
  it("formats naira compactly", () => {
    expect(formatCompactMoney({ currency: "NGN", amount: "141000000" })).toBe("₦141M");
    expect(formatCompactMoney({ currency: "NGN", amount: "2500000" })).toBe("₦2.5M");
  });

  it("falls back for non-ISO currency codes instead of throwing", () => {
    expect(formatCompactMoney({ currency: "USDC", amount: "4100" })).toBe("USDC 4.1K");
  });
});

describe("splitCurrencies", () => {
  it("leads with the largest and keeps the rest separate", () => {
    const out = splitCurrencies([{ currency: "NGN", amount: "9" }, { currency: "USD", amount: "1" }]);
    expect(out.lead?.currency).toBe("NGN");
    expect(out.others.map((o) => o.currency)).toEqual(["USD"]);
    expect(splitCurrencies([])).toEqual({ lead: null, others: [] });
  });
});

describe("visibleImpact", () => {
  const summary = (giftsReceived: number): ImpactSummary => ({ giftsReceived, givenByCurrency: [], fundsAndCampaigns: 0, paidOutByCurrency: [] });

  it("hides the section until there's enough real giving, and when there's no data", () => {
    expect(visibleImpact(null)).toBeNull();
    expect(visibleImpact(summary(impactMinGifts() - 1))).toBeNull();
    expect(visibleImpact(summary(impactMinGifts()))).not.toBeNull();
  });
});
