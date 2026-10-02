// Response shapes for the app/(founder) route group's API calls. Kept
// separate from lib/ops-types.ts rather than merged: several entities
// (Foundation, Waqf) have genuinely different shapes on each side —
// staff-facing responses carry fields (status, founder join info, etc.)
// the founder-facing ones don't — so a shared type would either lose
// fields or paper over a real difference. Not about deployment
// boundaries anymore (see CLAUDE.md's Tech Stack section on the merge).

export interface Foundation {
  id: string;
  name: string;
  purpose: string | null;
  jurisdiction: string | null;
  logoUrl: string | null;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  // Only present on GET /foundations/:id and GET /foundations (list) —
  // not written by the establish-a-Foundation POST responses.
  foundationFounders?: { founder: { id: string; name: string } }[];
  foundationDeed?: { id: string; typedLegalName: string; deedText: string; signedAt: string } | null;
  _count?: { waqfs: number };
}

export interface Waqf {
  id: string;
  foundationId: string;
  foundation: Foundation;
  name: string;
  type: "investment" | "asset" | "project";
  purpose: string | null;
  jurisdiction: string;
  status: "draft" | "active" | "suspended" | "dissolved";
  // Null on a waqf established before this feature existed — no
  // backfill was attempted (see the schema's own comment). fundingPlan
  // always has a value (defaults to lump_sum).
  corpusAmount: string | null;
  corpusCurrency: string | null;
  fundingPlan: "lump_sum" | "installment";
  // Computed on read (sum of confirmed Contributions), not stored —
  // present on GET /waqfs/:id and the founder-scoped equivalent, not list().
  amountRaised?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  // Present on GET /waqfs/:id only (not list()) — see
  // WaqfsService.findById's own comment. deedText is the verbatim
  // rendered legal text at signing time, the actual source of truth for
  // what was agreed to (see WaqfDeed's own schema comment). null before
  // signing.
  waqfDeed?: { id: string; typedLegalName: string; deedText: string; signedAt: string } | null;
  // Active causes registered/selected for this waqf — present on both
  // GET /waqfs (list) and the founder-scoped equivalent (see
  // WaqfsService.list's _count include, which runs unconditionally for
  // both the staff and founder-scoped branches). 2026-08-30 fix: this
  // field was already in every response the Founder Portal receives but
  // had no type here.
  causesCount?: number;
}

/** GET /banks — Paystack's own Nigerian bank catalog, proxied and cached. */
export interface Bank {
  name: string;
  code: string;
}

export interface WaqfCause {
  id: string;
  waqfId: string;
  causeCategoryId: string | null;
  name: string;
  description: string | null;
  // Birr-staff-authored, read-only here — see WaqfCause.projectPlan's
  // own schema comment for why this isn't Founder self-service the way
  // allocatedAmount below is.
  projectPlan: string | null;
  // How much of the waqf's live amountRaised (confirmed Contributions)
  // is earmarked to this cause — null means not yet allocated. Set via
  // POST /waqf-causes/:id/allocate, founder self-service, for every
  // waqf type. Update, 2026-09-14 — for an Investment-type waqf
  // specifically, this is no longer itself distributable (see
  // proceedsAllocatedAmount below): DistributionsService's own
  // allocation-ceiling check counts proceedsAllocatedAmount alone for
  // Investment funds, so this field there is a corpus-preservation
  // target the Founder can still set, not a spending ceiling.
  allocatedAmount: string | null;
  // Birr-staff-decided (WaqfProceedsService.allocateProceeds), never
  // founder-editable — but the backend's listForFounder() already
  // returns the full row (no select/omit), so this is present on every
  // founder-facing WaqfCause today; it was simply never typed here
  // before. Investment-type waqfs only (every other type has no
  // proceeds concept, per Vault.additionalCurrencies's own precedent —
  // see CLAUDE.md's 2026-08-28/2026-09-04 updates). The one real
  // distributable pool for Investment-type causes as of 2026-09-04.
  proceedsAllocatedAmount: string | null;
  createdAt: string;
  // Only present from the founder-facing listing (GET /waqf-causes as a
  // founder session) — counts, never names, so no beneficiary PII crosses
  // into the Founder Portal. pendingNominations added 2026-09-29 — see
  // WaqfCausesService.listForFounder's own comment on why an unselect
  // needs to warn about these too, not just approved beneficiaries.
  _count?: { beneficiaries: number; distributions: number; pendingNominations: number };
}

export interface WaqfProceeds {
  id: string;
  waqfId: string;
  investmentId: string | null;
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
}

export interface CauseCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  typicalWaqfTypes: Waqf["type"][];
  parentId: string | null;
}

// Vault — a separate, staff-curated public-giving product, no Founder
// involved (see packages/db/prisma/schema.prisma's own Vault section
// comment). Only the public-facing fields the homepage's "Support a
// cause" teaser needs — the Ops Console has its own, fuller copy in
// app/ops/lib/ops-types.ts.
export interface Vault {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: "investment" | "project";
  // Primary currency — targetAmount below and amountRaised's own entry
  // for this currency are what a goal/progress bar is shown against.
  currency: string;
  // Other currencies this vault also accepts for giving, beyond
  // `currency` above (2026-09-13) — see Vault.additionalCurrencies's
  // own schema comment for what this does and does not extend to.
  additionalCurrencies: string[];
  // Denominated in `currency` above only, even when additionalCurrencies
  // isn't empty — see that field's own comment.
  targetAmount: string | null;
  // One entry per currency this vault has actually received a confirmed
  // contribution in — never summed/converted across currencies (see
  // VaultsService.withAmountRaised's own comment on why). Empty array,
  // never missing, when nothing's been confirmed yet in any currency.
  amountRaised: { currency: string; amount: string }[];
  // Real committed program spend (every paid VaultDistribution + every
  // recorded VaultExpense), per currency — the Program Expenses ledger
  // account's own balance. Only present from GET /vaults/by-slug/:slug
  // (the detail page), not the open-vaults list/teaser grid — see
  // VaultsService.findBySlug's own comment on why.
  spentSoFar?: { currency: string; amount: string }[];
  jurisdiction: string;
  coverImageUrl: string | null;
  // A feasibility study, business case, or needs assessment — public
  // by design, unlike VaultMilestone's own evidence fields (see
  // Vault.feasibilityReportUrl's own schema comment on why this one's
  // meant for a donor's own due diligence, not staff-internal proof).
  feasibilityReportUrl: string | null;
  feasibilityReportTitle: string | null;
  // Only present from GET /vaults/by-slug/:slug and GET /vaults/:id —
  // both include it directly (see VaultsService.findBySlug/findById's
  // own `include`), which is what the public donation page reads
  // instead of a second call to the staff-only GET /vaults/:id/causes.
  causes?: VaultCause[];
  // Same "only present from findBySlug" posture as causes above.
  // Project-type vaults only — an investment vault's milestones array
  // is always empty. evidenceNotes/evidenceFileUrl are public here too
  // (2026-09-14) — the point of documenting completed work is showing
  // the donor who paid for it. targetAmount stays excluded (a budget
  // figure, not proof of anything).
  milestones?: VaultMilestone[];
}

export interface VaultCause {
  id: string;
  vaultId: string;
  causeCategoryId: string | null;
  name: string;
  description: string | null;
  // Brief, cause-specific write-up of how this cause's money is used —
  // see VaultCause.projectPlan's own schema comment. Distinct from
  // Vault.feasibilityReportUrl, which is campaign-wide.
  projectPlan: string | null;
  // Display-only fundraising goal for THIS cause, in the parent Vault's
  // primary currency — see VaultCause.targetAmount's own schema comment.
  // Never an enforcement ceiling (that's VaultCauseAllocation); null
  // means no goal has been set, same "optional, no bar shown" posture
  // Vault.targetAmount itself already has.
  targetAmount: string | null;
  // The CauseCategory catalog row's own emoji glyph, flattened onto the
  // cause by VaultsService.publicCause. null for a one-off custom cause,
  // which belongs to no category — callers need a fallback.
  icon: string | null;
  // How much has actually been given to THIS cause, per currency — same
  // confirmed-and-not-refunded basis as the vault's own amountRaised,
  // never summed across currencies. Present from both GET
  // /vaults/by-slug/:slug and GET /vaults/open (2026-10-02 — VaultCard's
  // browse-grid cards show this too, not just the detail page). These do
  // NOT add up to the vault's total: a gift left unearmarked ("wherever
  // it's needed most") counts toward the vault but toward no cause.
  amountRaised?: { currency: string; amount: string }[];
}

export interface VaultMilestone {
  id: string;
  name: string;
  sequence: number;
  status: "pending" | "in_progress" | "completed";
  evidenceNotes: string | null;
  evidenceFileUrl: string | null;
}

export interface CauseImpactUpdate {
  id: string;
  waqfCauseId: string;
  periodLabel: string;
  narrative: string;
  metricValue: number | null;
  metricLabel: string | null;
  createdAt: string;
  reportedByUser: { id: string; fullName: string };
}

// Shape of GET /cause-impact-updates with no waqfCauseId (a Founder
// session only) — every update across the whole portfolio, so each one
// needs to say which waqf/cause it belongs to.
export interface PortfolioCauseImpactUpdate extends CauseImpactUpdate {
  waqfCause: { id: string; name: string; waqf: { id: string; name: string } };
}

export interface CauseCategorySuggestion {
  id: string;
  name: string;
  description: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  proposedByFounder: { id: string; name: string };
  proposedByUser: { id: string; fullName: string };
  waqf: { id: string; name: string } | null;
  reviewedByUser: { id: string; fullName: string } | null;
  resultingCategory: { id: string; name: string } | null;
}

// Read-only Founder Portal visibility into a waqf's registered assets —
// no PII concern (an asset isn't a person), so this mirrors the Ops
// Console shape exactly rather than an aggregate. See
// AssetsService.listForFounder's own comment.
export interface Asset {
  id: string;
  waqfId: string;
  name: string;
  category: "real_estate" | "cash" | "securities" | "movable" | "intellectual_property" | "other";
  estimatedValue: string;
  // Always the waqf's own corpusCurrency at creation time — see
  // Asset.currency's own schema comment.
  currency: string;
  status: "active" | "disposed";
  disposedAt: string | null;
  createdAt: string;
}

// Read-only Founder Portal visibility into a waqf's investment
// allocations — same no-PII reasoning as Asset above. See
// InvestmentsService.listForFounder's own comment.
export interface Investment {
  id: string;
  waqfId: string;
  name: string;
  instrumentType: "sukuk" | "equity_fund" | "real_estate_fund" | "murabaha" | "other";
  allocatedAmount: string;
  // Always the waqf's own corpusCurrency at creation time — see
  // Investment.currency's own schema comment.
  currency: string;
  // See ops-types.ts's own Investment.status comment — same Shariah
  // screening gating, surfaced here too since this is real read-only
  // status a Founder can see.
  status: "pending_shariah_review" | "active" | "shariah_rejected" | "liquidated";
  liquidatedAt: string | null;
  createdAt: string;
}

// GET /distributions/summary — the same aggregated-by-cause shape Ops
// Console uses, deliberately never individual distribution rows. See
// DistributionsService.summaryByCauseForFounder's own comment.
export interface DistributionCauseSummary {
  causeId: string;
  causeName: string;
  currency: string;
  totalAmount: string;
  distributionCount: number;
  beneficiaryCount: number;
}

// GET /beneficiaries/summary — aggregate counts only, never a
// beneficiary's name or eligibility criteria. See
// BeneficiariesService.summaryForFounder's own comment on why beneficiary
// identity never crosses into the Founder Portal.
export interface BeneficiarySummary {
  total: number;
  byStatus: { active: number; inactive: number };
  byCause: { causeId: string; causeName: string; count: number }[];
  // Individual rows, owner's explicit decision on 2026-09-29 reversing
  // this endpoint's original aggregate-only posture — see
  // BeneficiariesService.summaryForFounder's own comment. Excludes
  // bank/payout details regardless (bankDetailsEncrypted, payoutProvider
  // stay staff-only).
  beneficiaries: {
    id: string;
    name: string;
    kind: "individual" | "organization";
    eligibilityCriteria: string;
    status: "active" | "inactive";
    phone: string | null;
    email: string | null;
    causeName: string | null;
    createdAt: string;
  }[];
}

// GET /founders/me/members — everyone with access to this Founder's own
// account, any status (so a revoked colleague still shows, not
// vanishes). Only a primary_contact can invite/revoke — see
// InvitationsController's assertPrimaryContact checks — but any active
// member can see this list.
export interface FounderMembership {
  id: string;
  founderId: string;
  userId: string;
  permissionLevel: "primary_contact" | "viewer" | "requester";
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  // mfaEnabled: added for the Ops Console's staff-facing GET
  // /founders/:id/members (FoundersService.listMembers backs both that
  // and the self-service GET /founders/me/members with the same query
  // shape) — harmless on the self-service side, just unused there.
  user: { id: string; fullName: string; email: string; mfaEnabled: boolean };
}

// GET /invitations (founder-scoped) — invitations this Foundation's
// primary contact has sent, any status.
export interface Invitation {
  id: string;
  inviteeKind: "founder_user" | "birr_staff" | "co_founder";
  email: string;
  founderId: string | null;
  // co_founder only — the existing Foundation this invitation, once
  // accepted, attaches a brand-new Founder to.
  foundationId: string | null;
  roleKey: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  // Always present — a copyable fallback link, regardless of whether
  // the email below actually sent.
  token: string;
  // Only present on the POST /invitations (create) response, not on
  // GET /invitations list rows.
  emailSent?: boolean;
}

// GET /governed-actions?waqfId= (founder session) — decided
// (approved/rejected) governance activity only, never the raw proposal
// payload — see GovernedActionsService.listDecidedForFounder's own
// comment on why. This is Birr staff's own accountability made visible,
// not a place a Founder acts on anything.
export interface WaqfGovernanceActivity {
  id: string;
  status: "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  permission: { key: string; category: string | null };
  checkerUser: { id: string; fullName: string } | null;
}

// Founder-facing, read-only (2026-09-15) — GET /waqf-milestones?waqfId=.
// Project-type Waqf Funds only. evidenceNotes/evidenceFileUrl are shown
// to the Founder who established this fund — unlike Vault's anonymous
// public donor, there's no one else this needs gating from, and the
// Founder is exactly who this proof of completed work is for.
export interface WaqfMilestone {
  id: string;
  waqfId: string;
  name: string;
  description: string | null;
  sequence: number;
  targetAmount: string | null;
  status: "pending" | "in_progress" | "completed";
  completedAt: string | null;
  evidenceNotes: string | null;
  evidenceFileUrl: string | null;
  createdAt: string;
  actualSpend: { currency: string; amount: string }[];
}

// GET /audit-logs/me (2026-09-14) — this Founder's own team's activity
// across every Foundation/Waqf Fund they're part of, scoped server-side
// by actorFounderId. Deliberately a thinner shape than Ops' own
// AuditLog type (ops-types.ts) — no before/after, no waqfId/entityId —
// see the backend route's own comment on why a raw payload never
// belongs in a scrollable activity feed.
export interface FounderAuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actorUser: { id: string; fullName: string } | null;
}

export interface FounderAuditLogPage {
  items: FounderAuditLogEntry[];
  nextCursor: string | null;
}

// The Founder Portal's "request" half of "view, request" — see
// FounderRequest's own schema comment. `details` is intentionally
// loosely typed here (its exact keys vary by `type`; see
// FounderRequestsService.REQUIRED_DETAIL_KEYS for the backend's own
// per-type shape) — this is a display-only record, never re-parsed
// into a stricter shape client-side.
export type FounderRequestType =
  | "distribution_approval"
  | "investment_change"
  | "beneficiary_criteria_change"
  | "asset_disposal"
  | "other";

export type FounderRequestStatus = "pending" | "in_review" | "actioned" | "declined";

export interface FounderRequest {
  id: string;
  waqfId: string;
  waqf: { id: string; name: string; type: "investment" | "asset" | "project" };
  type: FounderRequestType;
  details: Record<string, unknown>;
  note: string | null;
  status: FounderRequestStatus;
  reviewedByStaff: { id: string; user: { fullName: string } } | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface Contribution {
  id: string;
  waqfId: string;
  amount: string;
  currency: string;
  provider: "stripe" | "paystack" | "stablecoin";
  status: "pending" | "confirmed" | "failed";
  assetId: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

export interface VaultContribution {
  id: string;
  vaultId: string;
  amount: string;
  currency: string;
  provider: "stripe" | "paystack" | "stablecoin";
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
  confirmedAt: string | null;
  vault: { name: string; slug: string };
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

// Founder <-> Birr staff communication, scoped per Foundation — see
// packages/db/prisma/schema.prisma's own comment on the Message model.
export interface Message {
  id: string;
  foundationId: string;
  senderType: "birr_staff" | "founder_user";
  senderUser: { id: string; fullName: string };
  body: string;
  createdAt: string;
  attachments: MessageAttachment[];
}

// GET /messages/inbox — one row per Foundation with at least one
// message, most-recently-active first. See MessagesService.buildInbox's
// own comment on why "unread" isn't tracked here (derived client-side
// from the existing message.received Notification rows instead).
export interface MessagesInboxRow {
  foundation: { id: string; name: string };
  lastMessage: {
    id: string;
    body: string;
    senderType: "birr_staff" | "founder_user";
    senderUser: { id: string; fullName: string };
    createdAt: string;
  };
}

// GET /waqfs/:id/lifecycle — CLAUDE.md's 13 waqf lifecycle stages,
// computed live (never persisted). See WaqfsService.getLifecycleStatus's
// own comment for what each status value means.
export type LifecycleStageStatus = "complete" | "pending" | "not_applicable" | "not_available";

export interface WaqfLifecycleStatus {
  waqfId: string;
  stages: {
    establishment: { status: LifecycleStageStatus; completedAt?: string };
    legalDocumentation: { status: LifecycleStageStatus; signedAt?: string | null };
    assetRegistration: { status: LifecycleStageStatus; count?: number };
    governanceConfiguration: { status: LifecycleStageStatus; assignmentRoles?: string[] };
    investmentManagement: { status: LifecycleStageStatus; count?: number };
    beneficiaryAdministration: { status: LifecycleStageStatus; count?: number };
    distributionManagement: { status: LifecycleStageStatus; count?: number };
    complianceMonitoring: { status: LifecycleStageStatus; frameworkName?: string | null };
    financialReporting: { status: LifecycleStageStatus; count?: number };
    impactMeasurement: { status: LifecycleStageStatus; count?: number };
    audit: { status: LifecycleStageStatus; count?: number };
    successionManagement: { status: LifecycleStageStatus };
    longTermPreservation: { status: LifecycleStageStatus };
  };
  completedCount: number;
  trackableCount: number;
}

// GET /financial-reports/:waqfId — computed fresh on every call, never
// persisted as a "report" row, same posture as ComplianceReportsService
// .generate(). Reuses DistributionCauseSummary as-is for
// distributionsByCause (identical shape to what GET /distributions/summary
// already returns).
export interface FinancialReport {
  waqf: {
    id: string;
    name: string;
    type: Waqf["type"];
    jurisdiction: string;
    corpusAmount: string | null;
    corpusCurrency: string | null;
  };
  raised: { currency: string; totalAmount: string }[];
  distributed: { currency: string; totalAmount: string }[];
  distributionsByCause: DistributionCauseSummary[];
  // Per-currency, same shape as raised/distributed above — see
  // FinancialReportsService.generate's own comment (2026-09-16: used to
  // be a single blended-currency total).
  proceeds: { currency: string; totalAmount: string }[];
  causeAllocations: { id: string; name: string; allocatedAmount: string | null; proceedsAllocatedAmount: string | null }[];
  generatedAt: string;
}

// Opt-in MFA (apps/backend's FoundersService) — same shape as the
// birr_staff equivalents in ops-types.ts, just a separate declaration
// since founder pages don't otherwise import from that file.
export interface MfaEnrollmentStart {
  qrCodeDataUrl: string;
  secretForManualEntry: string;
}

export interface MfaEnrollmentConfirm {
  backupCodes: string[];
}

// Mirrors NotificationsService's own NOTIFICATION_PREFERENCE_CATEGORIES
// — a small, named subset of notification types a Founder can actually
// opt out of (see that file's own comment on why it's not every type).
export type NotificationPreferenceCategory = "governance" | "money" | "team" | "messages";

export type NotificationPreferences = Record<
  NotificationPreferenceCategory,
  { emailEnabled: boolean; whatsappEnabled: boolean }
>;
