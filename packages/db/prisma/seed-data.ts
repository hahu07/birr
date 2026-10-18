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
const governedPermissions = [
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
  // Resetting a Birr staff member's two-factor authentication (2026-10-01)
  // — previously one Platform Admin could do it alone, which meant a single
  // compromised or careless admin session could strip MFA from anyone. Now
  // maker-checker: a Platform Admin requests it, a Board member or
  // Compliance officer (never another Platform Admin — no role may be both
  // maker and checker) approves. Platform Admin is deliberately NOT a
  // checker: that role is "not a substitute for Board/Committee sign-off".
  // Same rule for a Founder Portal account (2026-10-01): a Founder who loses
  // their device and backup codes has no self-service recovery, and one
  // Platform Admin used to be able to strip their MFA alone. Maker:
  // platform_admin; checkers: board_of_trustees / compliance_officer.
  { key: "founder.mfa_reset", category: "founder", requiresMakerChecker: true, description: "Reset a Founder Portal user's two-factor authentication, forcing them to re-enrol." },
  { key: "staff.mfa_reset", category: "staff", requiresMakerChecker: true, description: "Reset a Birr staff member's two-factor authentication, forcing them to re-enrol." },
  // Adding a Birr staff member (2026-10-18). One Platform Admin used to be
  // able to invite anyone, into any role, alone — including a second
  // account of their own under a checker role, which would let one person
  // be both maker and checker on every governed action. Same two-person
  // rule as staff.mfa_reset: maker platform_admin; checkers
  // board_of_trustees / compliance_officer.
  { key: "staff.invite", category: "staff", requiresMakerChecker: true, description: "Invite a new Birr staff member into a given staff role." },
  // A staff member may hold several roles (2026-10-18). Adding or removing
  // one is the same two-person rule as staff.invite.
  { key: "staff.role_add", category: "staff", requiresMakerChecker: true, description: "Give an existing staff member an additional role." },
  { key: "staff.role_remove", category: "staff", requiresMakerChecker: true, description: "Take a role away from a staff member who holds more than one." },
  // Changing what a role may do, from the Ops Console (2026-10-18). Owner's
  // decisions: proposed by platform_admin, approved by board_of_trustees
  // only, and every permission is editable — this one included — subject
  // to the guard rails in GovernedActionsService (no lock-outs, no role
  // both proposes and approves, external_auditor stays read-only).
  { key: "role.permission_change", category: "staff", requiresMakerChecker: true, description: "Change what a staff role may propose, approve, or do." },
  { key: "waqf.milestone_complete", category: "distribution", requiresMakerChecker: true, description: "Mark a project waqf fund's milestone as completed, unlocking its distribution tranche." },
] as const;

// Plain access permissions (2026-10-18): who may perform an ungoverned
// staff action at all — record an expense, create a Vault, export the
// audit log. These replaced 97 hard-coded role checks
// (@RequiresStaffRole) with named permissions, granting exactly the roles
// each route allowed before; no access changed. Unlike the maker-checker
// permissions above there's no proposer/approver split: a grant is
// stored as canMaker: true and means "may do this" (PermissionGuard's
// @RequiresAccess). Each entry lists the roles that hold it.
export const accessPermissions = [
  // CLAUDE.md's Bashir rule: Legal/Compliance sign-off specifically, never
  // just any staff member — and deliberately no platform_admin override.
  { key: "agent_draft.publish", category: "content", description: "Publish an AI agent's (Bashir's) reviewed marketing draft.", roles: ["compliance_officer", "legal_adviser"] },
  { key: "asset.register", category: "waqf", description: "Register a new asset on a waqf fund.", roles: ["mutawalli_officer"] },
  // The roles CLAUDE.md's segregation of duties gives a compliance/audit
  // mandate to — not every staff member should pull the whole trustee-wide
  // compliance evidence export.
  { key: "audit_log.export", category: "audit", description: "Export the audit log and verify its tamper-evident hash chain.", roles: ["audit_committee", "external_auditor", "platform_admin"] },
  { key: "beneficiary.manage", category: "beneficiary", description: "Add beneficiaries to a waqf fund and set their payout details.", roles: ["mutawalli_officer"] },
  { key: "beneficiary.nomination_review", category: "beneficiary", description: "Approve or reject a beneficiary a Founder nominated.", roles: ["mutawalli_officer"] },
  // Deliberately not everyone on staff: this is public marketing for a
  // fiduciary service. Going live is separately the governed blog.publish.
  { key: "blog.manage", category: "content", description: "Write, edit, archive and unpublish blog articles (publishing itself is blog.publish).", roles: ["compliance_officer", "legal_adviser", "mutawalli_officer", "platform_admin"] },
  { key: "case_assignment.manage", category: "staff", description: "Assign staff to a waqf fund's caseload, and close assignments.", roles: ["mutawalli_officer", "platform_admin"] },
  { key: "caseload.view_all", category: "staff", description: "See every waqf fund's beneficiaries and Founder requests, not just assigned ones.", roles: ["platform_admin"] },
  { key: "cause_category.manage", category: "catalog", description: "Maintain the cause category catalog, including Founder suggestions.", roles: ["platform_admin"] },
  { key: "cause_impact.log", category: "waqf", description: "Log an impact update on a waqf fund's cause.", roles: ["mutawalli_officer"] },
  { key: "coi.review", category: "staff", description: "Review another staff member's conflict-of-interest declaration.", roles: ["compliance_officer"] },
  { key: "counterparty.payout_details", category: "counterparty", description: "Set a counterparty's payout bank details.", roles: ["mutawalli_officer"] },
  { key: "counterparty.register", category: "counterparty", description: "Register, edit and deregister a counterparty (investment or relief partner).", roles: ["investment_committee"] },
  { key: "counterparty.restrict", category: "counterparty", description: "Suspend or blacklist a counterparty, and set its concentration limit.", roles: ["compliance_officer"] },
  { key: "counterparty.shariah_approve", category: "shariah", description: "Give Shariah sign-off on a counterparty.", roles: ["shariah_board_member"] },
  { key: "distribution.create", category: "distribution", description: "Create a waqf distribution, and retry a failed payout.", roles: ["mutawalli_officer"] },
  // Legal and Compliance are included on purpose: hiding a photo is their
  // safeguarding lever.
  { key: "impact_photo.manage", category: "content", description: "Upload and moderate field photos.", roles: ["compliance_officer", "legal_adviser", "mutawalli_officer", "platform_admin"] },
  { key: "investment.create", category: "investment", description: "Add an investment to a waqf fund.", roles: ["investment_committee"] },
  { key: "investment.place", category: "investment", description: "Place an investment tranche with a counterparty, and record its proceeds.", roles: ["investment_committee"] },
  { key: "investment.shariah_screen", category: "shariah", description: "Decide the Shariah screening of a waqf investment.", roles: ["shariah_board_member"] },
  { key: "investment.target_set", category: "investment", description: "Set or remove a waqf fund's target investment mix.", roles: ["investment_committee"] },
  { key: "jurisdiction.manage", category: "compliance", description: "Maintain trustee licences and per-jurisdiction compliance policy sets.", roles: ["platform_admin"] },
  { key: "platform_settings.manage", category: "platform", description: "Change platform settings and provider credentials.", roles: ["platform_admin"] },
  { key: "shariah_sector.manage", category: "shariah", description: "Maintain the list of Shariah-prohibited sectors.", roles: ["platform_admin"] },
  { key: "staff.invitation_manage", category: "staff", description: "Resend or revoke a pending staff invitation.", roles: ["platform_admin"] },
  { key: "vault.contribution_hold", category: "vault", description: "Hold a Vault contribution for review, and release it.", roles: ["compliance_officer"] },
  { key: "vault.curate", category: "vault", description: "Create a Vault and edit its causes, goals, cover image and feasibility report.", roles: ["mutawalli_officer"] },
  { key: "vault.distribution_create", category: "vault", description: "Create a Vault distribution, and retry a failed payout.", roles: ["mutawalli_officer"] },
  { key: "vault.donor_threshold_set", category: "vault", description: "Set the donor ID-capture (AML) threshold per currency.", roles: ["compliance_officer"] },
  { key: "vault.expense_record", category: "vault", description: "Record a Vault programme expense.", roles: ["mutawalli_officer"] },
  { key: "vault.investment_create", category: "vault", description: "Add an investment to a Vault.", roles: ["investment_committee"] },
  { key: "vault.investment_shariah_screen", category: "shariah", description: "Decide the Shariah screening of a Vault investment.", roles: ["shariah_board_member"] },
  { key: "vault.investment_target_set", category: "vault", description: "Set or remove a Vault's target investment mix.", roles: ["investment_committee"] },
  { key: "vault.ledger_account_manage", category: "vault", description: "Add and retire Vault ledger accounts.", roles: ["platform_admin"] },
  { key: "vault.milestone_manage", category: "vault", description: "Add Vault milestones, start them, and attach evidence (completion is vault.milestone_complete).", roles: ["mutawalli_officer"] },
  { key: "vault.proceeds_record", category: "vault", description: "Record investment proceeds on a Vault.", roles: ["investment_committee", "mutawalli_officer"] },
  { key: "vault.status_change", category: "vault", description: "Pause, close or archive a Vault (publishing is vault.publish).", roles: ["compliance_officer", "mutawalli_officer"] },
  { key: "vault.structuring_review", category: "vault", description: "See the Vault anti-structuring (AML) review list.", roles: ["audit_committee", "board_of_trustees", "compliance_officer", "platform_admin"] },
  { key: "waqf.cause_manage", category: "waqf", description: "Add a custom cause to a waqf fund and edit its project plan.", roles: ["mutawalli_officer"] },
  { key: "waqf.expense_record", category: "waqf", description: "Record a waqf fund programme expense.", roles: ["mutawalli_officer"] },
  { key: "waqf.ledger_account_manage", category: "waqf", description: "Add and retire waqf ledger accounts.", roles: ["platform_admin"] },
  { key: "waqf.milestone_manage", category: "waqf", description: "Add waqf fund milestones, start them, and attach evidence (completion is waqf.milestone_complete).", roles: ["mutawalli_officer"] },
  { key: "waqf.proceeds_allocate", category: "investment", description: "Allocate a waqf fund's investment proceeds across its causes.", roles: ["investment_committee"] },
  { key: "waqf.proceeds_record", category: "investment", description: "Record investment proceeds on a waqf fund.", roles: ["investment_committee", "mutawalli_officer"] },
  { key: "waqf_funding.configure", category: "platform", description: "Set contribution and corpus minimums and waqf funding settings.", roles: ["platform_admin"] },
] as const satisfies readonly { key: string; category: string; description: string; roles: readonly string[] }[];


export const permissions = [
  ...governedPermissions,
  ...accessPermissions.map(({ key, category, description }) => ({ key, category, requiresMakerChecker: false, description })),
];


// role key -> permission key -> { canMaker, canChecker }
// No role is both the only maker and the only checker for any governed
// permission — segregation of duties is modeled here at the role level;
// the individual-level guarantee is the DB CHECK constraint on
// governed_actions (checker_not_maker), not this table.
type Grants = Record<string, { canMaker?: boolean; canChecker?: boolean }>;

const governedRolePermissions: Record<string, Grants> = {
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
    "founder.mfa_reset": { canChecker: true },
    "staff.mfa_reset": { canChecker: true },
    "staff.invite": { canChecker: true },
    "staff.role_add": { canChecker: true },
    "staff.role_remove": { canChecker: true },
    "role.permission_change": { canChecker: true },
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
    "founder.mfa_reset": { canChecker: true },
    "staff.mfa_reset": { canChecker: true },
    "staff.invite": { canChecker: true },
    "staff.role_add": { canChecker: true },
    "staff.role_remove": { canChecker: true },
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
    "founder.mfa_reset": { canMaker: true },
    "staff.mfa_reset": { canMaker: true },
    "staff.invite": { canMaker: true },
    "staff.role_add": { canMaker: true },
    "staff.role_remove": { canMaker: true },
    "role.permission_change": { canMaker: true },
  },
};

// Each role's governed grants plus every access permission listing it.
export const rolePermissions: Record<string, Grants> = Object.fromEntries(
  Object.entries(governedRolePermissions).map(([role, grants]) => [
    role,
    {
      ...grants,
      ...Object.fromEntries(
        accessPermissions
          .filter((p) => (p.roles as readonly string[]).includes(role))
          .map((p) => [p.key, { canMaker: true }]),
      ),
    },
  ]),
);

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
  // Update, 2026-10-02 — four additions grounded in Nigeria's own giving
  // patterns, not generic global NGO categories: Birr operates only as a
  // Nigeria-registered non-profit (see this file's own currency/minimum
  // seeds above), and these are distinct, recurring needs the original
  // seven don't name specifically enough to surface well in a Founder's
  // or a Vault donor's picker. Each is deliberately kept distinct from
  // its nearest existing neighbor rather than folded in — see each
  // entry's own note.
  //
  // Distinct from Disaster Relief: that's single-event emergency
  // response; this is the protracted, ongoing reality of Northern
  // Nigeria's conflict-driven displacement crisis (Boko Haram/ISWAP-
  // affected states), where camps and host communities need sustained
  // support, not one relief push.
  { name: "Displacement & IDP Support", description: "Shelter, food, and essentials for people displaced from their homes by conflict or crisis.", icon: "🏕️", sortOrder: 80, typicalWaqfTypes: ["project"] },
  // Also distinct from Disaster Relief: Nigeria's seasonal floods
  // (Niger Delta, Lagos, the 2022 floods) are a recurring, climate-
  // driven pattern with their own rebuild/water-management needs, not
  // one-off crisis response.
  { name: "Flood & Climate Relief", description: "Emergency response and rebuilding support for communities hit by flooding and seasonal climate disasters.", icon: "🌊", sortOrder: 90, typicalWaqfTypes: ["project"] },
  // Distinct from Poverty Relief: that's direct material aid (food,
  // shelter); this is enabling self-sufficiency (training, tools,
  // micro-grants) — the classical waqf/zakat distinction between giving
  // a fish and funding the means to earn one.
  { name: "Livelihood & Skills Empowerment", description: "Vocational training, micro-grants, and tools that help people earn a sustainable income.", icon: "🛠️", sortOrder: 100, typicalWaqfTypes: ["investment", "project"] },
  // Distinct from Orphan Care: that's child-focused; this is the
  // classical waqf/zakat beneficiary category of widows and families
  // who've lost their breadwinner, with needs (income replacement,
  // housing stability) that don't map onto a child-support program.
  { name: "Widow & Vulnerable Family Support", description: "Direct support for widows and families who've lost their primary breadwinner.", icon: "🫂", sortOrder: 110, typicalWaqfTypes: ["investment", "project"] },
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
