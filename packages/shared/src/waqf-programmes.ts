// The waqf programme products (2026-11-17, shared layer step 3): what each
// kind of waqf Birr establishes and curates is made of. One list, used by
// the backend (which pots and payments a programme may have, its default
// causes) and the web (labels, public address, monthly figures).
//
// A product's own parts (a clinic's price list, operator and claims) live
// in that product's module; this list only names them. The need-based waqf
// joins once it has the go-ahead and the Shariah Supervisory Board and
// Legal have answered the lending questions (its loan pot depends on them).

export interface MonthlyMeasure {
  key: string;
  label: string;
}

export interface WaqfProgrammeProductDefinition {
  /** Singular name, for labels: "Clinic". */
  label: string;
  /** Plural, for menus and lists: "Clinics". */
  plural: string;
  /** The public pages' address: a programme's page is `${publicPath}/${slug}`. */
  publicPath: string;
  /** The pots its ledger uses. */
  pots: readonly ("endowment" | "running")[];
  /** Kinds of endowment payment it makes (ProgrammeSpend.kind). */
  spendKinds: readonly ("equipment" | "works_stage" | "investment" | "reserve_replacement")[];
  /** Cause catalog entries (by name) a new programme is tagged with. */
  defaultCauses: readonly string[];
  /** The fixed measures its public monthly report shows. */
  monthlyMeasures: readonly MonthlyMeasure[];
  /** The product's own parts, beyond the shared ones. */
  ownParts: readonly string[];
}

export const WAQF_PROGRAMME_PRODUCTS = {
  clinic: {
    label: "Clinic",
    plural: "Clinics",
    publicPath: "/clinics",
    pots: ["endowment", "running"],
    spendKinds: ["equipment", "works_stage", "investment", "reserve_replacement"],
    defaultCauses: ["Healthcare"],
    monthlyMeasures: [
      { key: "visits", label: "Visits" },
      { key: "childrenImmunised", label: "Children immunised" },
      { key: "testsRun", label: "Tests run" },
      { key: "referrals", label: "Referrals" },
    ],
    ownParts: ["operator", "price list", "monthly claims", "monthly figures"],
  },
} as const satisfies Record<string, WaqfProgrammeProductDefinition>;

export type WaqfProgrammeProductKey = keyof typeof WAQF_PROGRAMME_PRODUCTS;

export function programmeProduct(key: WaqfProgrammeProductKey): WaqfProgrammeProductDefinition {
  return WAQF_PROGRAMME_PRODUCTS[key];
}
