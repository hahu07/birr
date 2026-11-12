import type { ZakahRuleset, ZakahRulings } from "./types";

/**
 * Starting proposals for the Shariah Supervisory Board to review — NOT
 * approved rulings. Every one is `draft`, and calculateZakah() refuses
 * a draft ruleset unless the caller explicitly opts in (tests, internal
 * previews). An approved version is expected to live in the database,
 * recorded through a governed action, not be edited here.
 *
 * nisabBasis and the nisab gram weights are the same in all four on
 * purpose: they're a contemporary choice for the Board, not something
 * that differs by madhhab (see ZakahRulings.nisabBasis).
 */
const sharedNisab: Pick<ZakahRulings, "nisabBasis" | "nisabGoldGrams" | "nisabSilverGrams"> = {
  nisabBasis: "gold",
  nisabGoldGrams: "85",
  nisabSilverGrams: "595",
};

export const draftRulesets: Record<ZakahRuleset["madhhab"], ZakahRuleset> = {
  maliki: {
    id: "maliki",
    version: 1,
    madhhab: "maliki",
    label: "Maliki",
    approval: { status: "draft" },
    // Debts: the Maliki school deducts debts from monetary wealth, but
    // first against any surplus non-zakatable property the payer could
    // sell to cover them. This draft deducts directly; the Board should
    // decide whether to model that offset.
    rulings: { personalJewellery: "exempt", debts: "deduct", ...sharedNisab },
  },
  hanafi: {
    id: "hanafi",
    version: 1,
    madhhab: "hanafi",
    label: "Hanafi",
    approval: { status: "draft" },
    rulings: { personalJewellery: "zakatable", debts: "deduct", ...sharedNisab },
  },
  shafii: {
    id: "shafii",
    version: 1,
    madhhab: "shafii",
    label: "Shafi'i",
    approval: { status: "draft" },
    rulings: { personalJewellery: "exempt", debts: "none", ...sharedNisab },
  },
  hanbali: {
    id: "hanbali",
    version: 1,
    madhhab: "hanbali",
    label: "Hanbali",
    approval: { status: "draft" },
    rulings: { personalJewellery: "exempt", debts: "deduct", ...sharedNisab },
  },
};
