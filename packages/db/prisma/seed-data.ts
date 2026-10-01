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
  { key: "beneficiary.status_change", category: "beneficiary", requiresMakerChecker: true, description: "Enable or disable a beneficiary." },
  { key: "counterparty.onboard", category: "counterparty", requiresMakerChecker: true, description: "Approve a counterparty (or its reactivation) to receive waqf investment money." },
  { key: "waqf.view", category: "waqf", requiresMakerChecker: false, description: "View waqf details. Not maker-checker gated." },
  { key: "compliance.report_export", category: "compliance", requiresMakerChecker: false, description: "Export a compliance report. Not maker-checker gated." },
  // Vault — a separate, staff-curated public-giving product (see
  // schema.prisma's own Vault section comment). All five governed here
  // specifically because there's no Founder to hold the self-service
  // half of the equivalent Waqf decisions, and it's public money —
  // vault.publish additionally because it's the moment Birr's brand
  // starts soliciting the public at all (owner's explicit decision,
  // 2026-09-11, closing a gap the original design flagged but left
  // open for v1).
  { key: "vault.publish", category: "vault", requiresMakerChecker: true, description: "Publish a draft vault, making it visible and open for public contributions." },
  { key: "vault.cause_allocate", category: "vault", requiresMakerChecker: true, description: "Allocate a vault's pooled contributions to one of its causes." },
  { key: "vault.proceeds_allocate", category: "vault", requiresMakerChecker: true, description: "Allocate an investment-style vault's recorded proceeds to one of its causes." },
  { key: "vault.investment_change", category: "vault", requiresMakerChecker: true, description: "Change a vault investment's allocation." },
  { key: "vault.distribution_approve", category: "vault", requiresMakerChecker: true, description: "Approve a vault distribution to a delivery-partner counterparty." },
  // Reversing a confirmed public gift — symmetrically the same class of
  // decision as vault.distribution_approve above (real money moving),
  // gated the same way. Part of the in-platform hold/refund workflow
  // (owner's explicit decision, 2026-09-11) replacing "staff fix it
  // manually through the provider's own dashboard" with an auditable,
  // maker-checker-gated decision inside Birr's own system.
  { key: "vault.contribution_refund", category: "vault", requiresMakerChecker: true, description: "Refund a confirmed vault contribution." },
  // Same fiduciary weight as vault.distribution_approve — verifying a
  // project milestone's real-world completion before the tranche it
  // unlocks can even be created (VaultDistributionsService.create()'s
  // own milestone-completion gate), not just a status label a single
  // staff member could set unilaterally.
  { key: "vault.milestone_complete", category: "vault", requiresMakerChecker: true, description: "Mark a project vault's milestone as completed, unlocking its distribution tranche." },
  // Founder/Waqf-side counterpart to vault.milestone_complete above
  // (2026-09-15) — same fiduciary weight as distribution.approve, so it
  // shares that permission's exact maker/checker set below rather than
  // vault.milestone_complete's own (broader) set.
  // Public educational articles (the /blog section). Marketing about a
  // fiduciary service is regulated, so taking one live is maker-checker
  // like vault.publish — and checkers are Legal/Compliance only (not the
  // Board, not just any staff member), per CLAUDE.md's Bashir row.
  { key: "blog.publish", category: "blog", requiresMakerChecker: true, description: "Publish a draft educational article to the public blog." },
  { key: "waqf.milestone_complete", category: "distribution", requiresMakerChecker: true, description: "Mark a project waqf fund's milestone as completed, unlocking its distribution tranche." },
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
    "waqf.milestone_complete": { canMaker: true },
    "investment.change": { canChecker: true },
    "beneficiary.criteria_update": { canMaker: true },
    "beneficiary.status_change": { canMaker: true },
    "counterparty.onboard": { canChecker: true },
    "waqf.view": { canMaker: true },
    "vault.publish": { canMaker: true },
    "vault.cause_allocate": { canMaker: true },
    "vault.distribution_approve": { canMaker: true },
    "vault.milestone_complete": { canMaker: true },
    "blog.publish": { canMaker: true },
  },
  // Apex checker across every maker-checker gated permission — the Board
  // is the last line of sign-off, distinct from (and above) the
  // committee-level checkers below. Never a maker: the Board approves
  // proposals, it doesn't originate them.
  board_of_trustees: {
    "asset.dispose": { canChecker: true },
    "distribution.approve": { canChecker: true },
    "waqf.milestone_complete": { canChecker: true },
    "investment.change": { canChecker: true },
    "beneficiary.criteria_update": { canChecker: true },
    "beneficiary.status_change": { canChecker: true },
    "counterparty.onboard": { canChecker: true },
    "waqf.view": { canMaker: true },
    "vault.publish": { canChecker: true },
    "vault.cause_allocate": { canChecker: true },
    "vault.proceeds_allocate": { canChecker: true },
    "vault.investment_change": { canChecker: true },
    "vault.distribution_approve": { canChecker: true },
    "vault.contribution_refund": { canChecker: true },
    "vault.milestone_complete": { canChecker: true },
  },
  investment_committee: {
    "asset.dispose": { canChecker: true },
    "investment.change": { canMaker: true },
    // Same reversed-pairing posture as investment.change: the committee
    // that actually sources and vets a counterparty relationship
    // proposes it; independent checkers (including Shariah, since
    // onboard()'s own precondition already requires their sign-off to
    // exist first) confirm.
    "counterparty.onboard": { canMaker: true },
    "waqf.view": { canMaker: true },
    "vault.proceeds_allocate": { canMaker: true },
    "vault.investment_change": { canMaker: true },
  },
  shariah_board_member: {
    "beneficiary.criteria_update": { canChecker: true },
    "beneficiary.status_change": { canChecker: true },
    "counterparty.onboard": { canChecker: true },
    "waqf.view": { canMaker: true },
    "vault.distribution_approve": { canChecker: true },
    "vault.milestone_complete": { canChecker: true },
  },
  audit_committee: {
    "asset.dispose": { canChecker: true },
    "investment.change": { canChecker: true },
    "counterparty.onboard": { canChecker: true },
    "compliance.report_export": { canMaker: true },
    "waqf.view": { canMaker: true },
    "vault.investment_change": { canChecker: true },
  },
  compliance_officer: {
    "distribution.approve": { canChecker: true },
    "waqf.milestone_complete": { canChecker: true },
    "beneficiary.criteria_update": { canChecker: true },
    "beneficiary.status_change": { canChecker: true },
    "compliance.report_export": { canMaker: true },
    "waqf.view": { canMaker: true },
    "vault.publish": { canChecker: true },
    "vault.cause_allocate": { canChecker: true },
    "vault.proceeds_allocate": { canChecker: true },
    "vault.distribution_approve": { canChecker: true },
    "vault.milestone_complete": { canChecker: true },
    // Maker, not checker, here — compliance is the role that actually
    // holds a contribution for review (see VaultContributionsService
    // .hold's own role gate) and is best placed to propose reversing
    // it; the Board (above) is the independent checker.
    "vault.contribution_refund": { canMaker: true },
    "blog.publish": { canChecker: true },
  },
  legal_adviser: {
    "waqf.view": { canMaker: true },
    "blog.publish": { canChecker: true },
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

// VaultContributionsService's AML anti-structuring guard (see that
// service's findOrCreateDonor comment) — crossing this, per currency,
// requires the public donor's name and ID. Previously unseeded entirely,
// meaning the check was a silent no-op in any fresh environment; these
// are starting placeholders, same "finance/compliance should tune per
// jurisdiction" caveat as every other minimum/threshold here.
// USDC/USDT are deliberately an order of magnitude below the fiat
// rails, not the same figure scaled by exchange rate like NGN's own row
// above — the owner's explicit decision (2026-09-11) to compensate for
// that rail being harder to unwind after the fact than a card or bank
// reversal (see StablecoinAdapter's own "receive-only" comment).
export const vaultDonorThresholds = [
  { currency: "USD", thresholdAmount: "10000" },
  { currency: "EUR", thresholdAmount: "10000" },
  { currency: "GBP", thresholdAmount: "10000" },
  { currency: "NGN", thresholdAmount: "15000000" },
  { currency: "USDC", thresholdAmount: "1000" },
  { currency: "USDT", thresholdAmount: "1000" },
] as const;

// Enforced in WaqfsService.create() when a founder declares a corpus —
// distinct from contributionMinimums above (that's the floor for a
// single payment; this is the floor for the total endowment target).
// An order of magnitude above the contribution minimum is a starting
// placeholder, same "finance/ops should correct this" caveat as
// contributionMinimums' own NGN row.
export const corpusMinimums = [
  { currency: "USD", minAmount: "1000" },
  { currency: "EUR", minAmount: "1000" },
  { currency: "GBP", minAmount: "1000" },
  { currency: "USDC", minAmount: "1000" },
  { currency: "USDT", minAmount: "1000" },
  { currency: "NGN", minAmount: "1500000" },
] as const;

// The starting standard catalog a Founder picks from for their own Waqf
// Fund (CauseCategoriesService) — Birr's product team maintains this
// list going forward via the Ops Console admin screen; this seed is just
// a reasonable starting menu, not the only causes that will ever exist.
// typicalWaqfTypes is a staff-curated UX hint only (see CauseCategory's
// own schema comment) — never a restriction on which types can pick a
// given cause.
export const causeCategories = [
  { name: "Education", description: "Scholarships, school fees, and educational materials.", icon: "🎓", sortOrder: 10, typicalWaqfTypes: ["investment", "project"] },
  { name: "Healthcare", description: "Medical treatment, clinics, and health access.", icon: "🏥", sortOrder: 20, typicalWaqfTypes: ["investment", "asset"] },
  { name: "Poverty Relief", description: "Direct support for people in need — food, shelter, basic needs.", icon: "🤝", sortOrder: 30, typicalWaqfTypes: ["investment", "project"] },
  { name: "Orphan Care", description: "Support for orphaned children and their guardians.", icon: "🧒", sortOrder: 40, typicalWaqfTypes: ["investment", "project"] },
  { name: "Religious Education", description: "Quran memorization, Islamic studies, and mosque support.", icon: "🕌", sortOrder: 50, typicalWaqfTypes: ["asset", "investment"] },
  { name: "Water & Sanitation", description: "Clean water access and sanitation infrastructure.", icon: "💧", sortOrder: 60, typicalWaqfTypes: ["project", "asset"] },
  { name: "Disaster Relief", description: "Emergency response to natural disasters and crises.", icon: "🚨", sortOrder: 70, typicalWaqfTypes: ["project"] },
] as const;

// The four accounts VaultLedgerService's three auto-posting hooks
// write to (confirmed contribution, paid distribution, recorded
// expense) — isSystemDefault: true so the Ops Console's chart-of-
// accounts page refuses to let staff delete them out from under the
// posting code. Staff add further expense sub-accounts (e.g.
// "Materials," "Labor," "Permits") through that same page for
// itemizing project spend; this seed only needs to cover what the
// system itself writes to automatically. Distributions Payable is
// reserved, not yet used by any posting rule — kept for a later
// accrual-basis slice rather than added only once actually needed.
// Classical Islamic finance screening exclusions — the sectors a
// ShariahScreening/VaultShariahScreening reviewer checks an investment
// against (see that model's own schema comment). Staff-curated via the
// Ops Console going forward; this seed only covers the well-established
// starting list.
export const shariahProhibitedSectors = [
  { name: "Conventional interest-based banking/lending", description: "Riba — conventional banks, lenders, and interest-bearing debt instruments." },
  { name: "Alcohol", description: "Production, distribution, or sale of alcoholic beverages." },
  { name: "Gambling", description: "Casinos, betting, lotteries, and other gambling/gaming operations." },
  { name: "Pork products", description: "Production or processing of pork or pork-derived products." },
  { name: "Conventional insurance", description: "Non-Takaful (conventional) insurance underwriting." },
  { name: "Weapons and defense", description: "Manufacture or sale of weapons, arms, and defense equipment." },
  { name: "Adult entertainment", description: "Pornography and adult entertainment production or distribution." },
  { name: "Tobacco", description: "Production or sale of tobacco and tobacco products." },
] as const;

export const vaultLedgerAccounts = [
  { code: "1000", name: "Cash & Bank", type: "asset", isSystemDefault: true },
  { code: "2000", name: "Distributions Payable", type: "liability", isSystemDefault: true },
  { code: "4000", name: "Donations Revenue", type: "revenue", isSystemDefault: true },
  { code: "5000", name: "Program Expenses", type: "expense", isSystemDefault: true },
] as const;

// Founder/Waqf-side counterpart to vaultLedgerAccounts above — same
// four codes/types, "Contributions Revenue" instead of "Donations
// Revenue" to match this side's own terminology (Contribution, not
// Donation). See WaqfLedgerAccount's own schema comment for why this
// separate seed exists (2026-09-15) rather than sharing Vault's rows.
export const waqfLedgerAccounts = [
  { code: "1000", name: "Cash & Bank", type: "asset", isSystemDefault: true },
  { code: "2000", name: "Distributions Payable", type: "liability", isSystemDefault: true },
  { code: "4000", name: "Contributions Revenue", type: "revenue", isSystemDefault: true },
  { code: "5000", name: "Program Expenses", type: "expense", isSystemDefault: true },
] as const;
