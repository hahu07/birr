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
  // How much of the waqf's live amountRaised (confirmed Contributions)
  // is earmarked to this cause, for every waqf type including
  // Investment — null means not yet allocated. Set via
  // POST /waqf-causes/:id/allocate, founder self-service. A separate,
  // staff-only proceeds-based pool also exists (WaqfCause
  // .proceedsAllocatedAmount) but never surfaces here — Birr staff
  // decide that one, not the Founder.
  allocatedAmount: string | null;
  createdAt: string;
  // Only present from the founder-facing listing (GET /waqf-causes as a
  // founder session) — counts, never names, so no beneficiary PII crosses
  // into the Founder Portal.
  _count?: { beneficiaries: number; distributions: number };
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
  status: "active" | "liquidated";
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
  user: { id: string; fullName: string; email: string };
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
  proceeds: { total: string } | null;
  causeAllocations: { id: string; name: string; allocatedAmount: string | null; proceedsAllocatedAmount: string | null }[];
  generatedAt: string;
}
