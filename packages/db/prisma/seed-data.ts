// Pure data, no PrismaClient/execution — split out of seed.ts so this can
// be imported (by seed.ts itself, and by tests asserting on the data) with
// zero side effects. seed.ts stays the only thing that touches the DB.

// Role keys must stay in sync with the BirrStaffRole enum in schema.prisma
// (see the comment on that enum) — these are Birr's own staff functions,
// distinct per CLAUDE.md's segregation-of-duties non-negotiable.
export const roles = [
  { key: "mutawalli_officer", name: "Mutawalli Officer", description: "Case-carrying trustee officer; typically proposes governed actions." },
  { key: "board_of_trustees", name: "Board of Trustees", description: "Apex governance body; final sign-off on the most consequential governed actions." },
  { key: "investment_committee", name: "Investment Committee", description: "Reviews and decides on investment/portfolio matters." },
  { key: "shariah_board_member", name: "Shariah Supervisory Board Member", description: "Shariah compliance oversight for waqf establishment and beneficiary criteria." },
  { key: "audit_committee", name: "Audit Committee", description: "Independent review of governed actions and financial controls." },
  { key: "compliance_officer", name: "Compliance Officer", description: "Regulatory and risk compliance review." },
  { key: "legal_adviser", name: "Legal Adviser", description: "Legal review of deeds and governed actions with legal exposure." },
  { key: "external_auditor", name: "External Auditor", description: "Independent third-party assurance; read-only by design — never a maker or checker on governed actions, to preserve external independence." },
  { key: "platform_admin", name: "Platform Admin", description: "Platform-level administration; not a substitute for Board/Committee sign-off." },
] as const;

// A representative slice of governed vs. ungoverned permissions — enough to
// exercise every requiresMakerChecker=true path CLAUDE.md calls out (asset
// disposal, distribution approval, investment changes, beneficiary-criteria
// changes) plus a couple of plain, non-governed reads. Waqf/Foundation
// *establishment* is no longer one of these — it's donor self-service now
// (see waqfs.controller.ts / foundations.controller.ts), not a
// governed_actions permission.
export const permissions = [
  { key: "asset.dispose", category: "asset", requiresMakerChecker: true, description: "Dispose of a waqf-held asset." },
  { key: "distribution.approve", category: "distribution", requiresMakerChecker: true, description: "Approve a beneficiary distribution." },
  { key: "investment.change", category: "investment", requiresMakerChecker: true, description: "Change an investment or portfolio allocation." },
  { key: "beneficiary.criteria_update", category: "beneficiary", requiresMakerChecker: true, description: "Update beneficiary eligibility criteria." },
  { key: "waqf.view", category: "waqf", requiresMakerChecker: false, description: "View waqf details. Not maker-checker gated." },
  { key: "compliance.report_export", category: "compliance", requiresMakerChecker: false, description: "Export a compliance report. Not maker-checker gated." },
] as const;

// role key -> permission key -> { canMaker, canChecker }
// No role is both the only maker and the only checker for any governed
// permission — segregation of duties is modeled here at the role level;
// the individual-level guarantee is the DB CHECK constraint on
// governed_actions (checker_not_maker), not this table.
export const rolePermissions: Record<string, Record<string, { canMaker?: boolean; canChecker?: boolean }>> = {
  mutawalli_officer: {
    "asset.dispose": { canMaker: true },
    "distribution.approve": { canMaker: true },
    "investment.change": { canChecker: true },
    "beneficiary.criteria_update": { canMaker: true },
    "waqf.view": { canMaker: true },
  },
  // Apex checker across every maker-checker gated permission — the Board
  // is the last line of sign-off, distinct from (and above) the
  // committee-level checkers below. Never a maker: the Board approves
  // proposals, it doesn't originate them.
  board_of_trustees: {
    "asset.dispose": { canChecker: true },
    "distribution.approve": { canChecker: true },
    "investment.change": { canChecker: true },
    "beneficiary.criteria_update": { canChecker: true },
    "waqf.view": { canMaker: true },
  },
  investment_committee: {
    "asset.dispose": { canChecker: true },
    "investment.change": { canMaker: true },
    "waqf.view": { canMaker: true },
  },
  shariah_board_member: {
    "beneficiary.criteria_update": { canChecker: true },
    "waqf.view": { canMaker: true },
  },
  audit_committee: {
    "asset.dispose": { canChecker: true },
    "investment.change": { canChecker: true },
    "compliance.report_export": { canMaker: true },
    "waqf.view": { canMaker: true },
  },
  compliance_officer: {
    "distribution.approve": { canChecker: true },
    "beneficiary.criteria_update": { canChecker: true },
    "compliance.report_export": { canMaker: true },
    "waqf.view": { canMaker: true },
  },
  legal_adviser: {
    "waqf.view": { canMaker: true },
  },
  // Read-only by design: no canMaker/canChecker grant on any
  // maker-checker gated permission. An external auditor who could
  // propose or approve governed actions wouldn't be independent of what
  // they're auditing.
  external_auditor: {
    "compliance.report_export": { canMaker: true },
    "waqf.view": { canMaker: true },
  },
  platform_admin: {
    "compliance.report_export": { canMaker: true },
    "waqf.view": { canMaker: true },
  },
};

// Enforced in ContributionsService.initiate() before a payment is ever
// created. NGN is a placeholder FX approximation of the ~$100 USD-
// equivalent default — finance/ops should correct it to a real rate
// rather than treating it as authoritative.
export const contributionMinimums = [
  { currency: "USD", minAmount: "100" },
  { currency: "EUR", minAmount: "100" },
  { currency: "GBP", minAmount: "100" },
  { currency: "USDC", minAmount: "100" },
  { currency: "USDT", minAmount: "100" },
  { currency: "NGN", minAmount: "150000" },
] as const;
