import { parsePositive, ZakahInputError } from "./internal";
import type { ZakahRulings } from "./types";

const CHOICES = {
  personalJewellery: ["zakatable", "exempt"],
  debts: ["deduct", "none"],
  nisabBasis: ["gold", "silver", "lower_of"],
} as const;

/**
 * Checks untrusted input (an API body, a database JSON column) is a
 * complete, valid set of rulings, and returns exactly those fields —
 * anything extra is dropped rather than stored. Shared by the backend
 * and the apps so all of them reject the same things.
 */
export function validateRulings(raw: unknown): ZakahRulings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ZakahInputError("rulings", "must be an object");
  }
  const r = raw as Record<string, unknown>;
  for (const [field, allowed] of Object.entries(CHOICES)) {
    if (!(allowed as readonly unknown[]).includes(r[field])) {
      throw new ZakahInputError(`rulings.${field}`, `must be one of ${allowed.map((a) => `"${a}"`).join(", ")}`);
    }
  }
  parsePositive("rulings.nisabGoldGrams", r.nisabGoldGrams);
  parsePositive("rulings.nisabSilverGrams", r.nisabSilverGrams);

  return {
    personalJewellery: r.personalJewellery as ZakahRulings["personalJewellery"],
    debts: r.debts as ZakahRulings["debts"],
    nisabBasis: r.nisabBasis as ZakahRulings["nisabBasis"],
    nisabGoldGrams: r.nisabGoldGrams as string,
    nisabSilverGrams: r.nisabSilverGrams as string,
  };
}
