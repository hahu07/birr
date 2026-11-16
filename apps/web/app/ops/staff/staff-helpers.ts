import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import type { BirrStaff, BirrStaffRole, StaffChangeEntry } from "../../../lib/ops-types";

export const STAFF_ROLES: BirrStaffRole[] = [
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

/** No sign-in for this long flags an account for review; it's never suspended automatically. */
export const DORMANT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every staff change needs a reason this long (the backend checks it too). */
export const REASON_MIN = 10;

export const roleLabel = (role: string) => humanize(role);

export const CHANGE_LABEL: Record<StaffChangeEntry["kind"], string> = {
  invite: "Invitation",
  role_add: "Add role",
  role_remove: "Remove role",
  mfa_reset: "Two-factor reset",
  suspend: "Suspension",
  reinstate: "Reinstatement",
};

export function describeChange(change: StaffChangeEntry): string {
  const role = change.role ? ` ${roleLabel(change.role)}` : "";
  switch (change.kind) {
    case "invite":
      return `Invite as${role}`;
    case "role_add":
      return `Add${role}`;
    case "role_remove":
      return `Remove${role}`;
    case "mfa_reset":
      return "Reset two-factor";
    case "suspend":
      return "Suspend";
    case "reinstate":
      return "Reinstate";
  }
}

/** Active, and no sign-in for DORMANT_DAYS (counting from when the account was made, if never signed in). */
export function isDormant(member: BirrStaff, now = Date.now()): boolean {
  if (member.status !== "active") return false;
  const last = member.user.lastSignInAt ?? member.createdAt;
  return now - new Date(last).getTime() > DORMANT_DAYS * DAY_MS;
}

export function signedInText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "No sign-in recorded";
  const days = Math.floor((now - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

/** Sends a staff change for approval; it takes effect only once a second person approves it. */
export function proposeStaffChange(permissionKey: string, payload: Record<string, unknown>) {
  return apiFetchJson("/governed-actions", { method: "POST", body: JSON.stringify({ permissionKey, payload }) });
}
