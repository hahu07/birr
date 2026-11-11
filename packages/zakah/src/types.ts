/**
 * Every amount crossing this package's boundary is a decimal *string*
 * in Naira ("3000000", "1250.50"), never a JS number — the same reason
 * the backend keeps money in Prisma.Decimal: a float can't represent
 * ₦0.10 exactly, and these figures end up on a receipt for an
 * obligation. Strings also survive JSON (API, React Native) unchanged.
 */
export type NairaAmount = string;

export type Madhhab = "maliki" | "hanafi" | "shafii" | "hanbali";

/**
 * The madhhab-dependent decisions this calculator makes. Each is data,
 * not code, so the Shariah Supervisory Board can approve (or change) a
 * ruleset without anyone rewriting the engine.
 */
export interface ZakahRulings {
  /**
   * Gold/silver jewellery worn for permissible personal use. Hanafi:
   * zakatable. Maliki, Shafi'i, Hanbali: exempt. Gold or silver held as
   * savings/investment (bars, coins, jewellery not worn) is zakatable
   * under every ruleset regardless of this setting.
   */
  personalJewellery: "zakatable" | "exempt";
  /**
   * Whether debts due now reduce zakatable wealth. "deduct": they do
   * (never below zero). "none": debts don't prevent or reduce zakah
   * (the relied-upon Shafi'i position).
   */
  debts: "deduct" | "none";
  /**
   * Which metal sets the Naira nisab. Not really a madhhab question —
   * classical texts give both 20 mithqal of gold and 200 dirhams of
   * silver; which one to apply to modern money is a contemporary fatwa
   * choice. "lower_of" uses whichever is cheaper that day (more people
   * owe zakah, which favours recipients). This choice moves the
   * threshold by roughly 10x, so it's the most consequential setting
   * here.
   */
  nisabBasis: "gold" | "silver" | "lower_of";
  /** Grams of pure gold in the nisab (85 and 87.48 are both in use). */
  nisabGoldGrams: string;
  /** Grams of pure silver in the nisab (595 and 612.36 are both in use). */
  nisabSilverGrams: string;
}

export type RulesetApproval =
  | { status: "draft" }
  | {
      status: "approved";
      /** ISO date the Shariah Supervisory Board approved this version. */
      approvedAt: string;
      /** The governed action that recorded the approval. */
      governedActionId: string;
    };

export interface ZakahRuleset {
  id: string;
  /** Bumped on every change, so a receipt can say exactly what applied. */
  version: number;
  madhhab: Madhhab;
  label: string;
  approval: RulesetApproval;
  rulings: ZakahRulings;
}

/**
 * Metal prices in Naira per gram of *pure* metal, set and dated by
 * Birr staff — deliberately not a live feed, so every calculation can
 * point to the exact figure it used and who set it.
 */
export interface MetalPrices {
  goldPerGram: NairaAmount;
  silverPerGram: NairaAmount;
  /** ISO date these prices apply to. */
  asOf: string;
  source: string;
}

export interface MetalHolding {
  metal: "gold" | "silver";
  /** Total weight in grams, as weighed (not pure content). */
  grams: string;
  /**
   * Fraction of pure metal, "0" to "1": 18k gold is "0.75", sterling
   * silver is "0.925". Use karatToPurity() for gold.
   */
  purity: string;
  /** Jewellery worn for personal use; see ZakahRulings.personalJewellery. */
  personalUse: boolean;
}

/**
 * Wealth the payer has held for a full lunar year (hawl). This first
 * slice covers monetary wealth only — livestock, crops, minerals,
 * shares, pensions and crypto each have their own rules and are not
 * accepted here yet.
 */
export interface ZakahInput {
  /** Cash at hand plus bank and mobile-money balances. */
  cash: NairaAmount;
  /** Business stock, valued at what it would sell for today. */
  tradeGoods: NairaAmount;
  /** Money owed to the payer that they expect to be repaid. */
  receivables: NairaAmount;
  metals: MetalHolding[];
  /** Debts the payer must pay now (not the whole of a long mortgage). */
  debtsDueNow: NairaAmount;
}

export type LineKind = "cash" | "trade_goods" | "receivables" | "metal" | "debts";

export interface CalculationLine {
  kind: LineKind;
  /** Naira value of this line (for a metal: pure grams × price). */
  value: NairaAmount;
  /** False when the ruleset excludes it, e.g. exempt personal jewellery. */
  counted: boolean;
  /** Plain-English explanation shown to the payer. */
  note: string;
}

export interface ZakahResult {
  ruleset: { id: string; version: number; madhhab: Madhhab; status: RulesetApproval["status"] };
  prices: MetalPrices;
  lines: CalculationLine[];
  /** Sum of counted assets. */
  totalAssets: NairaAmount;
  /** Debts actually deducted ("0" when the ruleset deducts none). */
  deductedDebts: NairaAmount;
  /** totalAssets − deductedDebts, never below zero. */
  netZakatableWealth: NairaAmount;
  nisab: { metal: "gold" | "silver"; grams: string; value: NairaAmount };
  meetsNisab: boolean;
  /** 2.5% of netZakatableWealth when nisab is met, else "0". */
  zakahDue: NairaAmount;
}
