import { describe, expect, it } from "vitest";
import { validateRulings } from "./validate";
import { draftRulesets } from "./rulesets";

const valid = draftRulesets.maliki.rulings;

describe("validateRulings", () => {
  it("accepts every bundled draft", () => {
    for (const ruleset of Object.values(draftRulesets)) {
      expect(validateRulings(ruleset.rulings)).toEqual(ruleset.rulings);
    }
  });

  it("drops fields it doesn't know rather than storing them", () => {
    expect(validateRulings({ ...valid, note: "<script>" })).toEqual(valid);
  });

  it.each([
    ["not an object", "maliki", "rulings"],
    ["an array", [], "rulings"],
    ["an unknown jewellery choice", { ...valid, personalJewellery: "sometimes" }, "rulings.personalJewellery"],
    ["a missing debts choice", { ...valid, debts: undefined }, "rulings.debts"],
    ["an unknown nisab basis", { ...valid, nisabBasis: "copper" }, "rulings.nisabBasis"],
    ["zero gold grams", { ...valid, nisabGoldGrams: "0" }, "rulings.nisabGoldGrams"],
    ["numeric silver grams", { ...valid, nisabSilverGrams: 595 }, "rulings.nisabSilverGrams"],
  ])("rejects %s", (_label, raw, field) => {
    expect(() => validateRulings(raw)).toThrow(expect.objectContaining({ name: "ZakahInputError", field }));
  });
});
