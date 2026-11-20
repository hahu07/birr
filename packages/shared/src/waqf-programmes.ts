// The waqf programme products (2026-11-17, shared layer step 3): what each
// kind of waqf Birr establishes and curates is made of. One list, used by
// the backend (which pots and payments a programme may have, its default
// causes) and the web (labels, public address, monthly figures).
//
// A product's own parts (a clinic's price list, operator and claims) live
// in that product's module; this list only names them, and a product's
// parts, pots and payment kinds are refused on any other product (in the
// services, and by the database: migration 20261119000500).
//
// Kifayah, Birr's graduation programme (approved as the need-based waqf on
// 2026-11-18, renamed by the Board on 2026-11-20), launches giving first:
// gifts and endowments, no support yet. Its financing fund, households and
// allowances come once the licensed partner and the kifayah line exist.

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
  /** What each pot is called for this product: the running pot is a clinic's "running fund". */
  potLabels: { readonly endowment: string; readonly running: string };
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
    potLabels: { endowment: "Endowment", running: "Running fund" },
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
  // Kifayah (Arabic for sufficiency), named by the Board on 2026-11-20. Its
  // key stays need_based, the database's name for the product since it was
  // the need-based waqf; only what people see changed.
  need_based: {
    label: "Kifayah",
    plural: "Kifayah",
    publicPath: "/kifayah",
    pots: ["endowment", "running"],
    potLabels: { endowment: "Endowment", running: "Spending fund" },
    // Endowed cash is invested; it never buys equipment, works or a
    // replacement reserve (equipment is sold by murabahah or given, never held).
    spendKinds: ["investment"],
    defaultCauses: ["Poverty Relief", "Livelihood & Skills Empowerment", "Widow & Vulnerable Family Support"],
    // No figures until support starts: the page states none about support.
    monthlyMeasures: [],
    ownParts: [],
  },
} as const satisfies Record<string, WaqfProgrammeProductDefinition>;

export type WaqfProgrammeProductKey = keyof typeof WAQF_PROGRAMME_PRODUCTS;

export function programmeProduct(key: WaqfProgrammeProductKey): WaqfProgrammeProductDefinition {
  return WAQF_PROGRAMME_PRODUCTS[key];
}
