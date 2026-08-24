"use client";

// Staff Management — the BirrStaff roster plus pending Invitations. This
// is the one page that lets Birr onboard more staff at all now that
// auth is real (see common/auth/current-birr-staff.ts on the backend):
// POST /birr-staff is platform_admin-only and meant for bootstrap/scripted
// use, so every other staff member is meant to arrive via an Invitation.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { humanize, formatDate } from "../../lib/format";
import { useStaffSession } from "../../lib/staff-session";
import type { BirrStaff, BirrStaffRole, Invitation } from "../../lib/types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconUsers,
  Input,
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
  const { staff: currentStaff } = useStaffSession();
  const [staff, setStaff] = useState<BirrStaff[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

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

  const pendingInvitations = invitations?.filter((i) => i.status === "pending") ?? [];

  return (
    <div>
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <IconUsers className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Staff</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Birr's own staff roster and pending onboarding invitations.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowInviteForm((v) => !v)}>
          {showInviteForm ? "Cancel" : "Invite staff member"}
        </Button>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load staff" className="mb-6">
          {error}
        </Alert>
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
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="font-medium text-slate-900">{s.user.fullName}</span>
                      {s.id === currentStaff?.id && (
                        <span className="ml-2 text-xs text-slate-400">(you)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-500">{s.user.email}</TableCell>
                    <TableCell>{humanize(s.staffRole)}</TableCell>
                    <TableCell>
                      <Badge tone={s.status === "active" ? "success" : "neutral"}>
                        {humanize(s.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                    <InvitationRow key={inv.id} invitation={inv} onChanged={load} />
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
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const invitation = await apiFetchJson<Invitation>("/invitations", {
        method: "POST",
        body: JSON.stringify({ inviteeKind: "birr_staff", email, roleKey }),
      });
      // No invitation-email adapter exists yet — the link is shown here
      // for staff to copy and send manually.
      setInviteLink(`${window.location.origin}/accept-invitation?token=${invitation.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (inviteLink) {
    return (
      <div className="mb-6 rounded-lg border border-primary-200 bg-primary-50 p-4">
        <p className="text-sm font-medium text-primary-900">Invitation created — send this link to {email}:</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded border border-primary-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
            {inviteLink}
          </code>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => navigator.clipboard.writeText(inviteLink)}
          >
            Copy
          </Button>
        </div>
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
        <Alert tone="danger" title="Couldn't send invitation">
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
          {submitting ? "Sending…" : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}

function InvitationRow({ invitation, onChanged }: { invitation: Invitation; onChanged: () => void }) {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/accept-invitation?token=${invitation.token}`;

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
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => navigator.clipboard.writeText(link)}
          >
            Copy link
          </Button>
          <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={revoking} onClick={revoke}>
            Revoke
          </Button>
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
