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
  _count: { waqfs: number };
}

export interface Waqf {
  id: string;
  foundationId: string;
  name: string;
  type: "investment" | "asset" | "project" | "hybrid";
  purpose: string | null;
  jurisdiction: string;
  status: "draft" | "active" | "suspended" | "closed";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  foundation: { id: string; name: string; purpose: string | null; jurisdiction: string | null };
  waqfDeed: { id: string; signedAt: string } | null;
  // Present on GET /waqfs/:id only (not list()) — see
  // WaqfsService.withTrusteeLicenseStatus on the backend.
  trusteeLicenseStatus?: TrusteeLicenseStatus | "unlicensed";
}

export type TrusteeLicenseStatus = "active" | "pending" | "suspended" | "expired";

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
  createdAt: string;
  updatedAt: string;
}

export interface WaqfCause {
  id: string;
  waqfId: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface Asset {
  id: string;
  waqfId: string;
  name: string;
  category: "real_estate" | "cash" | "securities" | "movable" | "intellectual_property" | "other";
  estimatedValue: string;
  status: "active" | "disposed";
  disposedAt: string | null;
  createdAt: string;
}

export interface Beneficiary {
  id: string;
  waqfId: string;
  causeId: string | null;
  name: string;
  eligibilityCriteria: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Investment {
  id: string;
  waqfId: string;
  name: string;
  instrumentType: "sukuk" | "equity_fund" | "real_estate_fund" | "murabaha" | "other";
  allocatedAmount: string;
  status: "active" | "liquidated";
  liquidatedAt: string | null;
  createdAt: string;
}

export interface Distribution {
  id: string;
  waqfId: string;
  causeId: string;
  beneficiaryId: string;
  amount: string;
  status: "pending" | "approved" | "rejected";
  approvedAt: string | null;
  createdAt: string;
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
  user: { id: string; email: string; fullName: string; status: string; mfaEnabled: boolean };
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
  // The backend always returns this (no invitation-email adapter is
  // wired up yet) — the UI uses it to build a copyable invite link for
  // staff to send manually. See app/staff/page.tsx.
  token: string;
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
  checkerUser: GovernedActionUser | null;
  waqf: { id: string; name: string } | null;
  // Only ever populated for a pending waqf.create action (no waqf exists
  // yet to show in `waqf` above) — resolved server-side from the
  // proposal's payload.foundationId.
  proposedFoundation: { id: string; name: string } | null;
}
