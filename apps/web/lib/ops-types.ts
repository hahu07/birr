// Shared API response shapes for the ops-console. Mirrors the NestJS
// backend's DTOs (apps/backend/src/modules/*) — kept hand-written here
// rather than generated, since the two apps aren't wired to a shared
// schema/codegen step yet.

export interface PlatformSettingField {
  key: string;
  label: string;
  secret: boolean;
  configured: boolean;
  maskedPreview: string | null;
  updatedAt: string | null;
  updatedByUser: { id: string; fullName: string } | null;
}

export type PlatformSettings = Record<string, { fields: PlatformSettingField[] }>;

export interface Founder {
  id: string;
  name: string;
  kind: "institution" | "individual";
  institutionType: string | null;
  homeJurisdiction: string | null;
  status: string;
}

export interface Foundation {
  id: string;
  name: string;
  purpose: string | null;
  jurisdiction: string | null;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  foundationFounders: { founder: { id: string; name: string } }[];
  foundationDeed?: { id: string; typedLegalName: string; deedText: string; signedAt: string } | null;
  _count: { waqfs: number };
}

export interface Waqf {
  id: string;
  foundationId: string;
  name: string;
  type: "investment" | "asset" | "project";
  purpose: string | null;
  jurisdiction: string;
  status: "draft" | "active" | "suspended" | "dissolved";
  // Nullable — a waqf established before this feature has none (no
  // backfill attempted, see the schema's own comment).
  corpusAmount: string | null;
  corpusCurrency: string | null;
  fundingPlan: "lump_sum" | "installment";
  // Computed on read, present on GET /waqfs/:id only (not list()).
  amountRaised?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  foundation: {
    id: string;
    name: string;
    purpose: string | null;
    jurisdiction: string | null;
    foundationDeed?: { id: string; signedAt: string } | null;
  };
  // Present on GET /waqfs/:id only (not list()) — see WaqfsService
  // .findById's own comment. Full WaqfDeed row (no select limiting on
  // the backend's `waqfDeed: true` include), matching lib/types.ts's own
  // shape for this field — 2026-08-30 fix, this used to be typed as
  // always-present with only {id, signedAt}, neither of which matched
  // the actual backend response.
  waqfDeed?: { id: string; typedLegalName: string; deedText: string; signedAt: string } | null;
  // Present on GET /waqfs/:id only (not list()) — see
  // WaqfsService.withTrusteeLicenseStatus on the backend.
  trusteeLicenseStatus?: JurisdictionLicenseStatus;
  // Present on GET /waqfs (list()) only — active causes registered/
  // selected for this waqf. See WaqfsService.list's _count include.
  causesCount?: number;
}

export type TrusteeLicenseStatus = "active" | "pending" | "suspended" | "expired";

// What TrusteeLicensesService.statusForJurisdiction actually returns —
// a superset of TrusteeLicenseStatus itself, since a jurisdiction can
// also have no license row at all ("unlicensed") or be explicitly
// exempt from needing one ("not_required" — see
// CompliancePolicySet.requiresTrusteeLicense's own comment).
export type JurisdictionLicenseStatus = TrusteeLicenseStatus | "unlicensed" | "not_required";

export interface TrusteeLicense {
  id: string;
  jurisdiction: string;
  status: TrusteeLicenseStatus;
  licensingAuthority: string;
  licenseNumber: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompliancePolicySet {
  id: string;
  jurisdiction: string;
  frameworkName: string;
  referenceUrl: string | null;
  notes: string | null;
  requiresTrusteeLicense: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WaqfCause {
  id: string;
  waqfId: string;
  causeCategoryId: string | null;
  name: string;
  description: string | null;
  // Founder-set, self-service, from the waqf's raised corpus — see
  // WaqfCausesService.allocate's own comment. Read-only on the Ops
  // side; one of two additive pools (see proceedsAllocatedAmount).
  allocatedAmount: string | null;
  // Birr-staff-set, from the waqf's recorded investment proceeds — see
  // WaqfCausesService.allocateProceeds's own comment. Additive to
  // allocatedAmount above, not a replacement; Investment-type waqfs
  // only (always null for every other waqf type). Editable here
  // (staff-only Ops Console) via CausesSection.tsx.
  proceedsAllocatedAmount: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface WaqfProceeds {
  id: string;
  waqfId: string;
  investmentId: string | null;
  amount: string;
  currency: string;
  description: string;
  recordedByUserId: string;
  createdAt: string;
}

export interface CauseCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  typicalWaqfTypes: ("investment" | "asset" | "project")[];
  parentId: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

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

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
  // Required in practice once payoutProvider is "paystack" and a
  // distribution to this beneficiary is actually approved — see
  // DistributionsService.assertPayoutReady's own comment. Optional here
  // since a beneficiary's bank details can be saved incomplete.
  bankCode?: string;
}

// Only "paystack" is a real, working payout rail today — "stripe" and
// "stablecoin" are honest stubs (see distributions/providers' own
// comments) that reject cleanly rather than pretending to succeed.
export type PayoutProvider = "stripe" | "paystack" | "stablecoin";

export interface Beneficiary {
  id: string;
  waqfId: string;
  causeId: string | null;
  name: string;
  kind: "individual" | "organization";
  eligibilityCriteria: string;
  status: "active" | "inactive";
  phone: string | null;
  email: string | null;
  // Decrypted server-side for this staff-facing shape only — see
  // BeneficiariesService.withDecryptedBankDetails's own comment. Never
  // present on any Founder-facing response.
  bankDetails: BankDetails | null;
  payoutProvider: PayoutProvider | null;
  eligibilityExpiresAt: string | null;
  createdAt: string;
}

export type InvestmentInstrumentType = "sukuk" | "equity_fund" | "real_estate_fund" | "murabaha" | "other";

export interface Investment {
  id: string;
  waqfId: string;
  name: string;
  instrumentType: InvestmentInstrumentType;
  allocatedAmount: string;
  // Always the waqf's own corpusCurrency at creation time — see
  // Investment.currency's own schema comment.
  currency: string;
  status: "active" | "liquidated";
  liquidatedAt: string | null;
  counterpartyId: string | null;
  // Set only when this row was created as one leg of a bulk
  // InvestmentPlacement — null for a standalone single-waqf investment
  // (every row created before that feature existed, and any created
  // outside a placement since).
  placementId: string | null;
  createdAt: string;
}

// One real-world placement of money with a counterparty, spread across
// however many Waqf Funds contributed to it — see
// InvestmentPlacementsService's own comment on the backend for why this
// exists (bulk-create + pro-rata proceeds split, instead of one form per
// fund and hand-calculated returns).
export interface InvestmentPlacement {
  id: string;
  name: string;
  instrumentType: InvestmentInstrumentType;
  counterpartyId: string;
  createdByUserId: string;
  createdAt: string;
}

// GET /investment-placements — list view, plain Investment rows.
export interface InvestmentPlacementSummary extends InvestmentPlacement {
  investments: Investment[];
}

// GET /investment-placements/:id — detail view, each Investment carries
// its own waqf's name for the fund-by-fund breakdown.
export interface InvestmentPlacementDetail extends InvestmentPlacement {
  counterparty: Counterparty;
  investments: (Investment & { waqf: { id: string; name: string; foundation: { id: string; name: string } } })[];
}

export interface Counterparty {
  id: string;
  name: string;
  institutionType: "bank" | "asset_manager" | "broker_dealer" | "fund_administrator" | "business" | "other";
  jurisdiction: string;
  status: "pending_review" | "active" | "under_review" | "suspended" | "blacklisted";
  registrationNumber: string | null;
  address: string | null;
  businessActivities: string | null;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  regulatoryLicenseNumber: string | null;
  regulatingAuthority: string | null;
  licenseExpiresAt: string | null;
  shariahApprovedAt: string | null;
  shariahApprovedByUserId: string | null;
  concentrationLimit: string | null;
  concentrationLimitCurrency: string | null;
  notes: string | null;
  existingShariahCertification: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  // Only present from the list endpoint (GET /counterparties) — one
  // groupBy query across every returned row, not per-row exposure()
  // calls. Sum of every `active` Investment's allocatedAmount referencing
  // this counterparty, across every waqf combined.
  totalInvested?: string;
}

export interface CounterpartyExposure {
  counterpartyId: string;
  totalInvested: string;
  concentrationLimit: string | null;
  concentrationLimitCurrency: string | null;
  remaining: string | null;
}

export interface Distribution {
  id: string;
  waqfId: string;
  causeId: string;
  beneficiaryId: string;
  amount: string;
  currency: string;
  // "approved" no longer means money moved — it only means the
  // governed-action decision was made and a real payout attempt has
  // started. See PayoutProvider's own schema comment for the full
  // lifecycle: approved -> disbursing (payout attempt sent) ->
  // paid/payout_failed (webhook-confirmed).
  status: "pending" | "approved" | "disbursing" | "paid" | "payout_failed" | "rejected";
  approvedAt: string | null;
  payoutProvider: PayoutProvider | null;
  payoutReference: string | null;
  paidAt: string | null;
  payoutError: string | null;
  createdAt: string;
}

export interface DistributionCauseSummary {
  causeId: string;
  causeName: string;
  currency: string;
  totalAmount: string;
  distributionCount: number;
  beneficiaryCount: number;
  // Staff-facing only — GET /distributions/summary omits this entirely
  // for a Founder session (beneficiary identity never crosses into the
  // Founder Portal, see DistributionsService.summaryByCause's own
  // comment). Undefined there, present (possibly empty) for Ops.
  beneficiaryNames?: string[];
}

export interface WaqfCaseAssignment {
  id: string;
  waqfId: string;
  birrStaffId: string;
  assignmentRole:
    | "mutawalli_officer"
    | "investment_officer"
    | "compliance_reviewer"
    | "shariah_reviewer"
    | "auditor";
  status: "active" | "reassigned" | "closed";
  assignedAt: string;
  closedAt: string | null;
  waqf: {
    id: string;
    name: string;
    type: string;
    jurisdiction: string;
    status: string;
    purpose: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
}

export interface ConflictOfInterestDeclaration {
  id: string;
  birrStaffId: string;
  waqfId: string | null;
  declarationText: string;
  status: "declared" | "reviewed" | "cleared" | "escalated";
  declaredAt: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  birrStaff: { id: string; staffRole: string; user: { id: string; fullName: string } };
  waqf: { id: string; name: string } | null;
  reviewedByUser: { id: string; fullName: string } | null;
}

export interface AiAgent {
  id: string;
  name: string;
  taskType:
    | "compliance_monitoring"
    | "caseload_triage"
    | "anomaly_detection"
    | "investment_research"
    | "founder_onboarding"
    | "beneficiary_verification"
    | "business_development"
    | "other";
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  // Real activity, not a fabricated readiness score — see
  // AiAgentsService.list()'s own comment on why CLAUDE.md's graduation
  // gate stays a human judgment call this API doesn't try to automate.
  draftCount: number;
  governedActionCount: number;
  lastActiveAt: string | null;
}

// GET /ai-agents/:id/drafts — the actual audit_logs rows an agent's own
// recordDraft() calls wrote. `after` carries the draft content itself;
// its shape varies per agent (Rasid's compliance summary vs Nazim's
// caseload digest), which is why this stays loosely typed here rather
// than a per-agent union — the frontend renders `summary` generically
// and falls back to raw JSON for the rest.
export interface AiAgentDraft {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  after: unknown;
  createdAt: string;
}

export interface GovernedActionPermission {
  id: string;
  key: string;
  description: string | null;
  category: string | null;
  requiresMakerChecker: boolean;
}

export interface GovernedActionUser {
  id: string;
  fullName: string;
  email: string;
}

export interface RolePermissionGrant {
  canMaker: boolean;
  canChecker: boolean;
  permission: GovernedActionPermission;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rolePermissions: RolePermissionGrant[];
}

// Mirrors the BirrStaffRole enum in schema.prisma — kept in sync by hand,
// same reasoning as every other type in this file.
export type BirrStaffRole =
  | "mutawalli_officer"
  | "board_of_trustees"
  | "investment_committee"
  | "shariah_board_member"
  | "audit_committee"
  | "compliance_officer"
  | "legal_adviser"
  | "external_auditor"
  | "platform_admin";

export interface BirrStaff {
  id: string;
  userId: string;
  staffRole: BirrStaffRole;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    status: string;
    mfaEnabled: boolean;
    whatsappNumber: string | null;
    whatsappVerifiedAt: string | null;
  };
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

export interface BeneficiaryNomination {
  id: string;
  waqfId: string;
  name: string;
  kind: "individual" | "organization";
  eligibilityCriteria: string;
  phone: string | null;
  email: string | null;
  bankDetails: BankDetails | null;
  payoutProvider: PayoutProvider | null;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  proposedByFounder: { id: string; name: string };
  proposedByUser: { id: string; fullName: string };
  cause: { id: string; name: string } | null;
  reviewedByUser: { id: string; fullName: string } | null;
  resultingBeneficiary: { id: string; name: string } | null;
}

export interface Invitation {
  id: string;
  inviteeKind: "founder_user" | "birr_staff";
  email: string;
  founderId: string | null;
  roleKey: string | null;
  invitedBy: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  // Always present — the UI uses it to build a copyable invite link as
  // a fallback, regardless of whether the email below actually sent.
  // See app/staff/page.tsx.
  token: string;
  // Only present on the POST /invitations (create) response, not on
  // GET /invitations list rows — whether ResendInvitationEmailAdapter
  // actually delivered the email. false doesn't mean the invitation
  // failed; the token/link above still works either way.
  emailSent?: boolean;
}

export interface AuditLog {
  id: string;
  waqfId: string | null;
  actorUserId: string | null;
  actorAgentId: string | null;
  actorFounderId: string | null;
  actorType: "birr_staff" | "founder_user" | "ai_agent" | "system";
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: string;
  // Resolved server-side for display — see AuditLogsController.list().
  actorUser: { id: string; fullName: string; email: string } | null;
  actorAgent: { id: string; name: string } | null;
  actorFounder: { id: string; name: string } | null;
}

// GET /audit-logs — cursor-paginated, not a plain array. nextCursor is
// null once there's nothing older left to load.
export interface AuditLogPage {
  items: AuditLog[];
  nextCursor: string | null;
}

// sequence/previousHash/recordHash come from the hash-chain migration —
// see AuditLogsService.verifyChain()/exportChain().
export interface AuditLogChainRecord extends AuditLog {
  sequence: number;
  previousHash: string | null;
  recordHash: string | null;
}

// GET /audit-logs/export
export interface AuditLogExport {
  exportedAt: string;
  totalRecords: number;
  chainHeadSequence: number | null;
  chainHeadHash: string | null;
  records: AuditLogChainRecord[];
}

// GET /audit-logs/verify — an empty issues array means the chain is
// intact end to end.
export interface AuditLogVerifyResult {
  ok: boolean;
  totalRecords: number;
  issues: { sequence: number; id: string; issue: string }[];
}

export interface GovernedAction {
  id: string;
  waqfId: string | null;
  permissionId: string;
  makerType: "human" | "ai_agent";
  makerUserId: string | null;
  makerAgentId: string | null;
  checkerUserId: string | null;
  status: "proposed" | "approved" | "rejected";
  payload: unknown;
  createdAt: string;
  decidedAt: string | null;
  permission: GovernedActionPermission;
  makerUser: GovernedActionUser | null;
  // Which specific ai_agents row proposed this, when makerType is
  // "ai_agent" — CLAUDE.md requires every agent-initiated action trace
  // back to a named registry row, not an undifferentiated "the AI."
  makerAgent: { id: string; name: string } | null;
  checkerUser: GovernedActionUser | null;
  waqf: { id: string; name: string } | null;
  // Only ever populated for a pending waqf.create action (no waqf exists
  // yet to show in `waqf` above) — resolved server-side from the
  // proposal's payload.foundationId.
  proposedFoundation: { id: string; name: string } | null;
  // Human-readable one-liner identifying this specific proposal (e.g.
  // "NGN 62,000 → Amina Yusuf (Orphan Care)") — resolved server-side
  // from the payload via each permission's own describePayload handler.
  // Null when the permission type has no handler for it, or its target
  // has since been deleted. See GovernedActionHandler.describePayload's
  // own comment on why this exists: rows sharing permission/waqf/
  // proposer/date are otherwise indistinguishable without expanding
  // each one and comparing raw entity ids by hand.
  summary: string | null;
}

// GET /compliance-reports/:waqfId — assembled fresh on every call
// (ComplianceReportsService.generate), not a persisted report row. Every
// call also writes its own audit_logs entry (action:
// "compliance_report.exported") — pulling this report is itself a
// compliance-relevant event.
export interface ComplianceReportGovernedAction {
  id: string;
  status: "proposed" | "approved" | "rejected";
  permission: { key: string; category: string | null };
  makerUser: { id: string; fullName: string } | null;
  makerAgent: { id: string; name: string } | null;
  checkerUser: { id: string; fullName: string } | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface ComplianceReportAuditLog {
  id: string;
  actorType: "birr_staff" | "founder_user" | "ai_agent" | "system";
  actorUser: { id: string; fullName: string } | null;
  actorAgent: { id: string; name: string } | null;
  actorFounder: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface ComplianceReport {
  waqf: Waqf;
  governedActions: ComplianceReportGovernedAction[];
  auditLogs: ComplianceReportAuditLog[];
  policySet: CompliancePolicySet | null;
  trusteeLicenseStatus: JurisdictionLicenseStatus;
  generatedAt: string;
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

// POST /birr-staff/me/mfa/enroll — see BirrStaffService.startMfaEnrollment.
export interface MfaEnrollmentStart {
  qrCodeDataUrl: string;
  secretForManualEntry: string;
}

// POST /birr-staff/me/mfa/enroll/confirm — backupCodes are plaintext and
// shown exactly once; see MfaBackupCode's own schema comment.
export interface MfaEnrollmentConfirm {
  backupCodes: string[];
}

// GET /founders/:id/members — a Founder's team roster, staff-facing.
// Used by the Ops Console's Foundation detail page to find the specific
// person to target for a break-glass MFA reset (MFA is a property of
// the individual User, not the Founder org, and a Founder can have more
// than one member via Team invites).
export interface FounderTeamMember {
  id: string;
  permissionLevel: "primary_contact" | "viewer" | "requester";
  status: "active" | "revoked";
  user: { id: string; fullName: string; email: string; mfaEnabled: boolean };
}
