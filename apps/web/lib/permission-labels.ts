// Readable names for staff permissions on Roles & Access and the
// Approvals page (2026-11-16): the permission's own description as its
// name, grouped under a plain-English area, with the key shown small.
import type { GovernedActionPermission } from "./ops-types";
import { humanizePermissionKey } from "./format";

const AREA_LABELS: Record<string, string> = {
  asset: "Waqf assets",
  audit: "Audit",
  beneficiary: "Beneficiaries",
  blog: "Articles",
  catalog: "Cause catalog",
  clinic: "Clinics",
  compliance: "Compliance",
  content: "Content",
  counterparty: "Counterparties",
  distribution: "Waqf distributions",
  founder: "Founders",
  investment: "Investments",
  platform: "Platform",
  shariah: "Shariah",
  staff: "Staff & access",
  vault: "Vaults",
  waqf: "Waqf funds",
  waqf_programme: "Waqf programmes",
  zakah: "Zakah",
};

export function areaLabel(category: string | null): string {
  if (!category) return "Other";
  return AREA_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " ");
}

/** The permission's description as its name, without the old "Not maker-checker gated." note. */
export function permissionLabel(permission: Pick<GovernedActionPermission, "key" | "description">): string {
  const text = permission.description?.replace(/\s*Not maker-checker gated\.?\s*$/i, "").trim();
  return text || humanizePermissionKey(permission.key);
}

export interface Grant {
  canMaker: boolean;
  canChecker: boolean;
}

export type GrantSetting = "none" | "proposes" | "approves" | "allowed";

export function settingOf(grant: Grant | undefined, approval: boolean): GrantSetting {
  if (!grant) return "none";
  if (!approval) return grant.canMaker ? "allowed" : "none";
  return grant.canMaker ? "proposes" : grant.canChecker ? "approves" : "none";
}

export function grantOf(setting: GrantSetting): Grant {
  return { canMaker: setting === "proposes" || setting === "allowed", canChecker: setting === "approves" };
}

export function settingLabel(setting: GrantSetting, approval: boolean): string {
  if (!approval) return setting === "allowed" ? "On" : "Off";
  return setting === "proposes" ? "Proposes" : setting === "approves" ? "Approves" : "None";
}

/** Display order: apex → committees → specialists → admin. */
export const ROLE_ORDER = [
  "mutawalli_officer",
  "board_of_trustees",
  "investment_committee",
  "shariah_board_member",
  "audit_committee",
  "compliance_officer",
  "legal_adviser",
  "external_auditor",
  "platform_admin",
];
