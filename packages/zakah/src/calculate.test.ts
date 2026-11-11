import { describe, expect, it } from "vitest";
import { calculateZakah, DraftRulesetError, karatToPurity, ZakahInputError } from "./calculate";
import { draftRulesets } from "./rulesets";
import type { MetalPrices, ZakahInput, ZakahRuleset, ZakahRulings } from "./types";

// Illustrative prices only, not market data: with these, the gold
// nisab (85g) is ₦12,750,000 and the silver nisab (595g) is ₦1,190,000.
const prices: MetalPrices = {
  goldPerGram: "150000",
  silverPerGram: "2000",
  asOf: "2027-02-08",
  source: "test fixture",
};

const allowDraft = { allowDraftRuleset: true };

function withRulings(ruleset: ZakahRuleset, rulings: Partial<ZakahRulings>): ZakahRuleset {
  return { ...ruleset, rulings: { ...ruleset.rulings, ...rulings } };
}

const maliki = draftRulesets.maliki;
const malikiSilver = withRulings(maliki, { nisabBasis: "silver" });

// Amina: ₦3,000,000 savings, ₦1,200,000 shop stock, ₦400,000 debts.
const amina: ZakahInput = {
  cash: "3000000",
  tradeGoods: "1200000",
  receivables: "0",
  metals: [],
  debtsDueNow: "400000",
};

describe("calculateZakah", () => {
  it("charges 2.5% of net wealth once it reaches the nisab", () => {
    const result = calculateZakah(amina, malikiSilver, prices, allowDraft);

    expect(result.totalAssets).toBe("4200000.00");
    expect(result.deductedDebts).toBe("400000.00");
    expect(result.netZakatableWealth).toBe("3800000.00");
    expect(result.nisab).toEqual({ metal: "silver", grams: "595", value: "1190000.00" });
    expect(result.meetsNisab).toBe(true);
    expect(result.zakahDue).toBe("95000.00");
  });

  it("owes nothing below the nisab — the same wealth under a gold-based nisab", () => {
    const result = calculateZakah(amina, maliki, prices, allowDraft);

    expect(result.nisab).toEqual({ metal: "gold", grams: "85", value: "12750000.00" });
    expect(result.meetsNisab).toBe(false);
    expect(result.zakahDue).toBe("0.00");
  });

  it("uses the cheaper metal for a lower_of nisab", () => {
    const result = calculateZakah(amina, withRulings(maliki, { nisabBasis: "lower_of" }), prices, allowDraft);
    expect(result.nisab.metal).toBe("silver");
  });

  it("treats wealth exactly at the nisab as meeting it", () => {
    const result = calculateZakah(
      { ...amina, cash: "1190000", tradeGoods: "0", debtsDueNow: "0" },
      malikiSilver,
      prices,
      allowDraft,
    );
    expect(result.meetsNisab).toBe(true);
    expect(result.zakahDue).toBe("29750.00");
  });

  it("rounds a fraction of a kobo up, in the recipients' favour", () => {
    const result = calculateZakah(
      { ...amina, cash: "1190000.01", tradeGoods: "0", debtsDueNow: "0" },
      malikiSilver,
      prices,
      allowDraft,
    );
    // 2.5% of ₦1,190,000.01 is ₦29,750.00025.
    expect(result.zakahDue).toBe("29750.01");
  });

  it("never lets debts push wealth below zero", () => {
    const result = calculateZakah({ ...amina, debtsDueNow: "9000000" }, malikiSilver, prices, allowDraft);

    expect(result.deductedDebts).toBe("4200000.00");
    expect(result.netZakatableWealth).toBe("0.00");
    expect(result.meetsNisab).toBe(false);
    expect(result.zakahDue).toBe("0.00");
  });

  describe("madhhab differences", () => {
    // 20g of 18k gold worn as jewellery: 15g pure, ₦2,250,000.
    const withJewellery: ZakahInput = {
      ...amina,
      metals: [{ metal: "gold", grams: "20", purity: karatToPurity(18), personalUse: true }],
    };

    it("counts personal jewellery under Hanafi", () => {
      const result = calculateZakah(withJewellery, withRulings(draftRulesets.hanafi, { nisabBasis: "silver" }), prices, allowDraft);

      const metal = result.lines.find((l) => l.kind === "metal")!;
      expect(metal).toMatchObject({ value: "2250000.00", counted: true });
      expect(result.netZakatableWealth).toBe("6050000.00");
      expect(result.zakahDue).toBe("151250.00");
    });

    it.each(["maliki", "shafii", "hanbali"] as const)("exempts personal jewellery under %s", (madhhab) => {
      const result = calculateZakah(withJewellery, draftRulesets[madhhab], prices, allowDraft);

      const metal = result.lines.find((l) => l.kind === "metal")!;
      expect(metal).toMatchObject({ value: "2250000.00", counted: false });
      expect(result.totalAssets).toBe("4200000.00");
    });

    it("counts gold held as savings under every madhhab", () => {
      const savings: ZakahInput = {
        ...amina,
        metals: [{ metal: "gold", grams: "20", purity: karatToPurity(18), personalUse: false }],
      };
      for (const ruleset of Object.values(draftRulesets)) {
        const result = calculateZakah(savings, ruleset, prices, allowDraft);
        expect(result.lines.find((l) => l.kind === "metal")!.counted).toBe(true);
      }
    });

    it("does not deduct debts under Shafi'i", () => {
      const result = calculateZakah(amina, withRulings(draftRulesets.shafii, { nisabBasis: "silver" }), prices, allowDraft);

      expect(result.deductedDebts).toBe("0.00");
      expect(result.lines.find((l) => l.kind === "debts")!.counted).toBe(false);
      expect(result.netZakatableWealth).toBe("4200000.00");
      expect(result.zakahDue).toBe("105000.00");
    });
  });

  it("keeps the shown lines adding up to the total, even for fractional metal values", () => {
    const result = calculateZakah(
      {
        ...amina,
        metals: [
          { metal: "gold", grams: "1.333", purity: karatToPurity(22), personalUse: false },
          { metal: "silver", grams: "10.07", purity: "0.925", personalUse: false },
        ],
      },
      malikiSilver,
      prices,
      allowDraft,
    );
    const counted = result.lines
      .filter((l) => l.counted && l.kind !== "debts")
      .reduce((sum, l) => sum + Math.round(Number(l.value) * 100), 0);
    expect(counted).toBe(Math.round(Number(result.totalAssets) * 100));
  });

  it("records the ruleset version and prices it used", () => {
    const result = calculateZakah(amina, maliki, prices, allowDraft);
    expect(result.ruleset).toEqual({ id: "maliki", version: 1, madhhab: "maliki", status: "draft" });
    expect(result.prices).toEqual(prices);
  });

  describe("draft rulesets", () => {
    it("refuses a draft ruleset unless explicitly allowed", () => {
      expect(() => calculateZakah(amina, maliki, prices)).toThrow(DraftRulesetError);
    });

    it("accepts an approved ruleset without the opt-in", () => {
      const approved: ZakahRuleset = {
        ...malikiSilver,
        approval: { status: "approved", approvedAt: "2027-01-15", governedActionId: "ga_test" },
      };
      const result = calculateZakah(amina, approved, prices);
      expect(result.ruleset.status).toBe("approved");
      expect(result.zakahDue).toBe("95000.00");
    });
  });

  describe("input validation", () => {
    it.each([
      ["a negative amount", { cash: "-5" }, "cash"],
      ["exponent notation", { cash: "1e6" }, "cash"],
      ["an empty string", { tradeGoods: "" }, "tradeGoods"],
      ["a JS number instead of a string", { debtsDueNow: 1000 as unknown as string }, "debtsDueNow"],
    ])("rejects %s", (_label, override, field) => {
      expect(() => calculateZakah({ ...amina, ...override }, maliki, prices, allowDraft)).toThrow(
        expect.objectContaining({ name: "ZakahInputError", field }),
      );
    });

    it("rejects purity above 1", () => {
      const input = { ...amina, metals: [{ metal: "gold" as const, grams: "10", purity: "1.2", personalUse: false }] };
      expect(() => calculateZakah(input, maliki, prices, allowDraft)).toThrow(ZakahInputError);
    });

    it("rejects a zero metal price, which would make everyone meet the nisab", () => {
      expect(() => calculateZakah(amina, maliki, { ...prices, silverPerGram: "0" }, allowDraft)).toThrow(
        expect.objectContaining({ field: "prices.silverPerGram" }),
      );
    });
  });
});

describe("karatToPurity", () => {
  it("converts karats to a fraction of pure gold", () => {
    expect(karatToPurity(24)).toBe("1");
    expect(karatToPurity(18)).toBe("0.75");
    expect(karatToPurity(21)).toBe("0.875");
  });

  it("rejects karats outside 1–24", () => {
    expect(() => karatToPurity(25)).toThrow(ZakahInputError);
    expect(() => karatToPurity(0)).toThrow(ZakahInputError);
  });
});
