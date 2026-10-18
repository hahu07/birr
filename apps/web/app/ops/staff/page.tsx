"use client";

// Staff Management — the BirrStaff roster plus pending Invitations.
// Adding a staff member is the `staff.invite` governed action (2026-10-18):
// a platform_admin proposes it here, a Board member or the Compliance
// Officer approves it on the Approvals page, and only then is the
// invitation created and emailed. Staff invitation links are never shown
// in the app — the API returns no token for them — so a failed email is
// retried with "Resend email", not a copy-able link.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize, formatDate } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import { ProposeGovernedActionButton } from "../_components/ProposeGovernedAction";
import type { BirrStaff, BirrStaffRole, Invitation } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconUsers,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const STAFF_ROLES: BirrStaffRole[] = [
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

export default function StaffPage() {
  const { staff: currentStaff, can } = useStaffSession();
  const [staff, setStaff] = useState<BirrStaff[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [search, setSearch] = useState("");
  const canInvite = can("staff.invite");
  const canRequestMfaReset = can("staff.mfa_reset");
  const canManageInvitations = can("staff.invitation_manage");
  const canAddRole = can("staff.role_add");
  const canRemoveRole = can("staff.role_remove");
  const load = useCallback(() => {
    setError(null);
    Promise.all([apiFetchJson<BirrStaff[]>("/birr-staff"), apiFetchJson<Invitation[]>("/invitations")])
      .then(([staffData, invitationsData]) => {
        setStaff(staffData);
        setInvitations(invitationsData);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fewer than two active Platform Admins means a locked-out admin has
  // nobody to request their MFA reset in the app — see
  // docs/staff-mfa-recovery.md (paths A and B).
  const activePlatformAdmins = staff?.filter((s) => s.roles.includes("platform_admin") && s.status === "active").length ?? 0;

  const pendingInvitations = invitations?.filter((i) => i.status === "pending") ?? [];
  const query = search.trim().toLowerCase();
  const visibleStaff =
    staff?.filter(
      (s) =>
        !query ||
        s.user.fullName.toLowerCase().includes(query) ||
        s.user.email.toLowerCase().includes(query) ||
        s.roles.some((role) => role.toLowerCase().includes(query)),
    ) ?? [];

  return (
    <div>
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
            <IconUsers className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Birr's own staff roster and pending onboarding invitations.
            </p>
          </div>
        </div>
        {canInvite && (
          <Button onClick={() => setShowInviteForm((v) => !v)}>
            {showInviteForm ? "Cancel" : "Invite staff member"}
          </Button>
        )}
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load staff" className="mb-6">
          {error}
        </Alert>
      )}

      {canRequestMfaReset && staff !== null && activePlatformAdmins < 2 && (
        <Alert tone="warning" title="Only one active Platform Admin" className="mb-6">
          If this account loses its authenticator and backup codes, nobody can request its MFA reset in the app — it
          would need the server-side emergency procedure. Invite a second Platform Admin. See
          docs/staff-mfa-recovery.md.
        </Alert>
      )}

      {canRequestMfaReset && (
        <p className="mb-4 text-xs text-slate-500">
          "Request MFA reset" doesn't reset anything by itself — a Board member or Compliance officer has to approve it
          on the Approvals page, and the person is emailed once it's done.
        </p>
      )}

      {showInviteForm && (
        <InviteForm
          onInvited={() => {
            setShowInviteForm(false);
            load();
          }}
        />
      )}

      {!error && staff === null && <StaffSkeleton />}

      {!error && staff !== null && (
        <>
          {staff.length === 0 ? (
            <EmptyState
              title="No staff accounts yet"
              description="Invite the first Birr staff member above."
            />
          ) : (
            <>
              <Input
                placeholder="Search by name, email, or role…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-4 max-w-xs"
              />
              {visibleStaff.length === 0 ? (
                <p className="text-sm text-slate-500">No staff match "{search.trim()}".</p>
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Name</TableHeaderCell>
                      <TableHeaderCell>Email</TableHeaderCell>
                      <TableHeaderCell>Role</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>2FA</TableHeaderCell>
                      {canRequestMfaReset && <TableHeaderCell className="text-right">Actions</TableHeaderCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleStaff.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <span className="font-medium text-slate-900">{s.user.fullName}</span>
                          {s.id === currentStaff?.id && (
                            <span className="ml-2 text-xs text-slate-500">(you)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-500">{s.user.email}</TableCell>
                        <TableCell>
                          <RolesCell
                            member={s}
                            // Nobody proposes a change to their own roles —
                            // the backend refuses it too.
                            canAdd={canAddRole && s.id !== currentStaff?.id}
                            canRemove={canRemoveRole && s.id !== currentStaff?.id}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge tone={s.status === "active" ? "success" : "neutral"}>
                            {humanize(s.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge tone={s.user.mfaEnabled ? "success" : "warning"}>
                            {s.user.mfaEnabled ? "Enrolled" : "Not enrolled"}
                          </Badge>
                        </TableCell>
                        {canRequestMfaReset && (
                          <TableCell className="text-right">
                            {s.user.mfaEnabled && (
                              <ProposeGovernedActionButton
                                permissionKey="staff.mfa_reset"
                                payload={{ staffId: s.id }}
                                label="Request MFA reset"
                                onProposed={load}
                              />
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}

          {pendingInvitations.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Pending invitations</h2>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Email</TableHeaderCell>
                    <TableHeaderCell>Role</TableHeaderCell>
                    <TableHeaderCell>Expires</TableHeaderCell>
                    <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pendingInvitations.map((inv) => (
                    <InvitationRow key={inv.id} invitation={inv} canManageInvitations={canManageInvitations} onChanged={load} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<BirrStaffRole>("mutawalli_officer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "staff.invite", payload: { email, staffRole: roleKey } }),
      });
      setProposed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (proposed) {
    return (
      <div className="mb-6 rounded-lg border border-primary-200 bg-primary-50 p-4">
        <p className="text-sm font-medium text-primary-900">Sent for approval.</p>
        <p className="mt-1 text-sm text-primary-800">
          A Board member or the Compliance Officer needs to approve adding {email} as {humanize(roleKey)} on the Approvals
          page. The invitation is emailed to them once it&apos;s approved.
        </p>
        <div className="mt-3">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onInvited}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't send for approval">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <label htmlFor="invite-email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <Input
            id="invite-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium text-slate-700">
            Role
          </label>
          <select
            id="invite-role"
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value as BirrStaffRole)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {humanize(role)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send for approval"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        A second person (Board or Compliance) approves every new staff member before the invitation is emailed.
      </p>
    </form>
  );
}

// A staff member's roles, with propose-to-add / propose-to-remove controls
// for whoever holds staff.role_add / staff.role_remove. Every change is a
// governed proposal a Board member or the Compliance Officer approves on
// the Approvals page — nothing here changes anyone's roles directly.
function RolesCell({ member, canAdd, canRemove }: { member: BirrStaff; canAdd: boolean; canRemove: boolean }) {
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<BirrStaffRole | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // external_auditor stands alone: an auditor can't gain a role, and nobody
  // who already holds one can become an auditor.
  const addable = member.roles.includes("external_auditor")
    ? []
    : STAFF_ROLES.filter((r) => !member.roles.includes(r) && r !== "external_auditor");

  async function propose(kind: "add" | "remove", target: BirrStaffRole) {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: `staff.role_${kind}`, payload: { staffId: member.id, role: target } }),
      });
      setSent(`${kind === "add" ? "Adding" : "Removing"} ${humanize(target)} — sent for approval.`);
      setAdding(false);
      setRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {member.roles.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700"
          >
            {humanize(r)}
            {canRemove && member.roles.length > 1 && !sent && (
              <button
                type="button"
                title={`Propose removing ${humanize(r)}`}
                aria-label={`Propose removing ${humanize(r)}`}
                disabled={submitting}
                onClick={() => propose("remove", r)}
                className="text-slate-400 hover:text-red-600"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {canAdd && addable.length > 0 && !adding && !sent && (
          <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => setAdding(true)}>
            + Add role
          </button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-2">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as BirrStaffRole)}
            className="w-48 py-1 text-xs"
            aria-label={`Role to add for ${member.user.fullName}`}
          >
            <option value="">Choose a role…</option>
            {addable.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
          <Button className="px-2.5 py-1 text-xs" disabled={!role || submitting} onClick={() => role && propose("add", role)}>
            Send for approval
          </Button>
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}
      {sent && <p className="text-xs text-slate-500">{sent}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function InvitationRow({ invitation, canManageInvitations, onChanged }: { invitation: Invitation; canManageInvitations: boolean; onChanged: () => void }) {
  const [revoking, setRevoking] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  // Null for a staff invitation — its link is emailed only, never shown.
  const link = invitation.token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/ops/accept-invitation?token=${invitation.token}`
    : null;

  async function resend() {
    setError(null);
    setResendState("sending");
    try {
      const { emailSent } = await apiFetchJson<{ emailSent: boolean }>(`/invitations/${invitation.id}/resend-email`, { method: "POST" });
      if (!emailSent) throw new Error("The email couldn't be sent — check the Resend settings and try again.");
      setResendState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setResendState("idle");
    }
  }

  async function revoke() {
    setError(null);
    setRevoking(true);
    try {
      await apiFetchJson(`/invitations/${invitation.id}/revoke`, { method: "POST" });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setRevoking(false);
    }
  }

  return (
    <TableRow>
      <TableCell>{invitation.email}</TableCell>
      <TableCell>{invitation.roleKey ? humanize(invitation.roleKey) : "—"}</TableCell>
      <TableCell className="text-slate-500">{formatDate(invitation.expiresAt)}</TableCell>
      <TableCell className="text-right">
        {error && <span className="mr-3 text-xs text-red-600">{error}</span>}
        <div className="inline-flex gap-2">
          {link && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => navigator.clipboard.writeText(link)}>
              Copy link
            </Button>
          )}
          {canManageInvitations && invitation.inviteeKind === "birr_staff" && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={resendState !== "idle"} onClick={resend}>
              {resendState === "sending" ? "Sending…" : resendState === "sent" ? "Email sent" : "Resend email"}
            </Button>
          )}
          {/* A birr_staff invitation is platform_admin-only to revoke, same as to send — see InvitationsService.revoke. */}
          {(canManageInvitations || invitation.inviteeKind !== "birr_staff") && (
            <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={revoking} onClick={revoke}>
              Revoke
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function StaffSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
