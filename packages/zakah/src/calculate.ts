import DecimalJs from "decimal.js";
import type {
  CalculationLine,
  MetalPrices,
  NairaAmount,
  ZakahInput,
  ZakahResult,
  ZakahRuleset,
} from "./types";

// A private Decimal constructor, so this package never changes the
// global decimal.js configuration another library (e.g. Prisma) relies on.
const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
type Decimal = InstanceType<typeof Decimal>;

const ZAKAH_RATE = new Decimal("0.025");
const ZERO = new Decimal(0);

export class ZakahInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "ZakahInputError";
  }
}

export class DraftRulesetError extends Error {
  constructor(readonly rulesetId: string) {
    super(
      `Ruleset "${rulesetId}" is a draft and has not been approved by the Shariah Supervisory Board. ` +
        "Pass { allowDraftRuleset: true } only for tests or internal previews.",
    );
    this.name = "DraftRulesetError";
  }
}

export interface CalculateOptions {
  /** Permit a draft ruleset. Never set this for a payer-facing result. */
  allowDraftRuleset?: boolean;
}

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

function parseAmount(field: string, raw: string): Decimal {
  if (typeof raw !== "string" || !PLAIN_DECIMAL.test(raw)) {
    throw new ZakahInputError(field, `must be a non-negative decimal string like "1500" or "1500.50", got ${JSON.stringify(raw)}`);
  }
  return new Decimal(raw);
}

function parsePositive(field: string, raw: string): Decimal {
  const value = parseAmount(field, raw);
  if (value.lessThanOrEqualTo(0)) throw new ZakahInputError(field, "must be greater than zero");
  return value;
}

/** Rounds to the kobo, half-up — used for every displayed value. */
function toKobo(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function format(value: Decimal): NairaAmount {
  return value.toFixed(2);
}

/** 24k is pure gold: 18k → "0.75", 21k → "0.875". */
export function karatToPurity(karat: number): string {
  if (!Number.isInteger(karat) || karat < 1 || karat > 24) {
    throw new ZakahInputError("karat", "must be a whole number from 1 to 24");
  }
  return new Decimal(karat).dividedBy(24).toString();
}

/**
 * Zakah on monetary wealth held for a full lunar year, under one
 * ruleset. Pure: no I/O, no clock, no prices of its own — the caller
 * supplies the staff-set prices, and the result echoes back the
 * ruleset version and prices it used so it can be stored and shown on
 * a receipt exactly as calculated.
 */
export function calculateZakah(
  input: ZakahInput,
  ruleset: ZakahRuleset,
  prices: MetalPrices,
  options: CalculateOptions = {},
): ZakahResult {
  if (ruleset.approval.status === "draft" && !options.allowDraftRuleset) {
    throw new DraftRulesetError(ruleset.id);
  }
  const { rulings } = ruleset;

  const goldPrice = parsePositive("prices.goldPerGram", prices.goldPerGram);
  const silverPrice = parsePositive("prices.silverPerGram", prices.silverPerGram);

  const lines: CalculationLine[] = [];
  const addLine = (kind: CalculationLine["kind"], value: Decimal, counted: boolean, note: string) => {
    lines.push({ kind, value: format(value), counted, note });
    return counted ? value : ZERO;
  };

  let totalAssets = ZERO;
  totalAssets = totalAssets.plus(
    addLine("cash", toKobo(parseAmount("cash", input.cash)), true, "Cash, bank and mobile-money balances"),
  );
  totalAssets = totalAssets.plus(
    addLine("trade_goods", toKobo(parseAmount("tradeGoods", input.tradeGoods)), true, "Business stock at today's selling value"),
  );
  totalAssets = totalAssets.plus(
    addLine("receivables", toKobo(parseAmount("receivables", input.receivables)), true, "Money owed to you that you expect back"),
  );

  input.metals.forEach((holding, i) => {
    const field = `metals[${i}]`;
    if (holding.metal !== "gold" && holding.metal !== "silver") {
      throw new ZakahInputError(`${field}.metal`, 'must be "gold" or "silver"');
    }
    const grams = parseAmount(`${field}.grams`, holding.grams);
    const purity = parseAmount(`${field}.purity`, holding.purity);
    if (purity.greaterThan(1)) throw new ZakahInputError(`${field}.purity`, 'must be between "0" and "1"');

    const pureGrams = grams.times(purity);
    const value = toKobo(pureGrams.times(holding.metal === "gold" ? goldPrice : silverPrice));
    const exempt = holding.personalUse && rulings.personalJewellery === "exempt";
    const what = holding.metal === "gold" ? "Gold" : "Silver";
    const note = exempt
      ? `${what} jewellery for personal use — not zakatable under the ${ruleset.label} ruleset`
      : `${what}, ${pureGrams.toDecimalPlaces(3).toString()}g pure${holding.personalUse ? " (personal jewellery, zakatable under this ruleset)" : ""}`;
    totalAssets = totalAssets.plus(addLine("metal", value, !exempt, note));
  });

  const debts = toKobo(parseAmount("debtsDueNow", input.debtsDueNow));
  const deductsDebts = rulings.debts === "deduct";
  // Debts can only bring wealth down to zero, never below it.
  const deductedDebts = deductsDebts ? Decimal.min(debts, totalAssets) : ZERO;
  addLine(
    "debts",
    debts,
    deductsDebts,
    deductsDebts ? "Debts you must pay now, deducted" : `Debts are not deducted under the ${ruleset.label} ruleset`,
  );

  const netZakatableWealth = totalAssets.minus(deductedDebts);

  const goldNisab = toKobo(parsePositive("rulings.nisabGoldGrams", rulings.nisabGoldGrams).times(goldPrice));
  const silverNisab = toKobo(parsePositive("rulings.nisabSilverGrams", rulings.nisabSilverGrams).times(silverPrice));
  const nisabMetal =
    rulings.nisabBasis === "lower_of" ? (silverNisab.lessThanOrEqualTo(goldNisab) ? "silver" : "gold") : rulings.nisabBasis;
  const nisabValue = nisabMetal === "gold" ? goldNisab : silverNisab;

  const meetsNisab = netZakatableWealth.greaterThan(0) && netZakatableWealth.greaterThanOrEqualTo(nisabValue);
  // Rounded up to the kobo: when a fraction of a kobo is in doubt, the
  // obligation is resolved in the recipients' favour, not the payer's.
  const zakahDue = meetsNisab ? netZakatableWealth.times(ZAKAH_RATE).toDecimalPlaces(2, Decimal.ROUND_UP) : ZERO;

  return {
    ruleset: { id: ruleset.id, version: ruleset.version, madhhab: ruleset.madhhab, status: ruleset.approval.status },
    prices: { ...prices },
    lines,
    totalAssets: format(totalAssets),
    deductedDebts: format(deductedDebts),
    netZakatableWealth: format(netZakatableWealth),
    nisab: {
      metal: nisabMetal,
      grams: nisabMetal === "gold" ? rulings.nisabGoldGrams : rulings.nisabSilverGrams,
      value: format(nisabValue),
    },
    meetsNisab,
    zakahDue: format(zakahDue),
  };
}
