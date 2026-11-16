"use client";

// Team — Birr's own staff, rebuilt 2026-11-16 to the same standard as
// Roles & Access. Every change to a person (inviting them, adding or
// removing a role, resetting two-factor, suspending or reinstating) is a
// governed two-person action: proposed here with a reason, approved by a
// Board member or Compliance officer on the Approvals page. The roster
// shows what's awaiting approval, who hasn't set up two-factor, and who
// hasn't signed in for 90 days (flagged for review, never suspended
// automatically). Staff invitation links are emailed only, never shown.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShowMoreFooter, useShowMore } from "../_components/ShowMore";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { BirrStaff, BirrStaffRole, Invitation, StaffChangeEntry } from "../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, IconUsers, Input, Select, Skeleton } from "@birr/ui";
import { MemberPanel } from "./MemberPanel";
import { REASON_MIN, STAFF_ROLES, describeChange, isDormant, proposeStaffChange, roleLabel, signedInText } from "./staff-helpers";

const STAFF_PER_PAGE = 25;
type Filter = "all" | "active" | "suspended" | "attention";

export default function StaffPage() {
  const { staff: me, can } = useStaffSession();
  const [staff, setStaff] = useState<BirrStaff[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [pending, setPending] = useState<StaffChangeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [search, setSearch] = useState("");
  // Active staff first; suspended accounts are one filter away.
  const [filter, setFilter] = useState<Filter>("active");
  const [role, setRole] = useState<BirrStaffRole | "">("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      apiFetchJson<BirrStaff[]>("/birr-staff"),
      apiFetchJson<Invitation[]>("/invitations"),
      apiFetchJson<StaffChangeEntry[]>("/birr-staff/pending-changes"),
    ])
      .then(([staffData, invitationsData, pendingData]) => {
        setStaff(staffData);
        setInvitations(invitationsData);
        setPending(pendingData);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingFor = useCallback((id: string) => pending.filter((p) => p.staffId === id), [pending]);
  const counts = useMemo(() => {
    const list = staff ?? [];
    return {
      active: list.filter((s) => s.status === "active").length,
      suspended: list.filter((s) => s.status === "suspended").length,
      noTwoFactor: list.filter((s) => s.status === "active" && !s.user.mfaEnabled).length,
      dormant: list.filter((s) => isDormant(s)).length,
    };
  }, [staff]);
  const needsAttention = (s: BirrStaff) => s.status === "active" && (!s.user.mfaEnabled || isDormant(s));

  const query = search.trim().toLowerCase();
  const visible = (staff ?? []).filter(
    (s) =>
      (!query || s.user.fullName.toLowerCase().includes(query) || s.user.email.toLowerCase().includes(query)) &&
      (!role || s.roles.includes(role)) &&
      (filter === "all" || (filter === "attention" ? needsAttention(s) : s.status === filter)),
  );
  const page = useShowMore(visible, STAFF_PER_PAGE, `${query}|${filter}|${role}`);

  // Fewer than two active Platform Admins means a locked-out admin has
  // nobody to request their MFA reset in the app — see
  // docs/staff-mfa-recovery.md (paths A and B).
  const activePlatformAdmins = staff?.filter((s) => s.roles.includes("platform_admin") && s.status === "active").length ?? 0;
  const sentInvitations = invitations?.filter((i) => i.status === "pending" && i.inviteeKind === "birr_staff") ?? [];
  const invitationPage = useShowMore(sentInvitations, STAFF_PER_PAGE, "invitations");
  const invitesAwaiting = pending.filter((p) => p.kind === "invite");
  const nameOfUser = (userId: string) => staff?.find((s) => s.userId === userId)?.user.fullName ?? "—";
  const open = staff?.find((s) => s.id === openId) ?? null;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
            <IconUsers className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team</h1>
            <p className="mt-0.5 text-sm text-slate-500">Birr&apos;s staff. Every change to someone&apos;s access needs a reason and a second person&apos;s approval.</p>
          </div>
        </div>
        {can("staff.invite") && <Button onClick={() => setShowInviteForm((v) => !v)}>{showInviteForm ? "Cancel" : "Invite staff member"}</Button>}
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load staff" className="mb-6">
          {error}
        </Alert>
      )}

      {can("staff.mfa_reset") && staff !== null && activePlatformAdmins < 2 && (
        <Alert tone="warning" title="Only one active Platform Admin" className="mb-6">
          If this account loses its authenticator and backup codes, nobody can request its MFA reset in the app — it would need the server-side
          emergency procedure. Invite a second Platform Admin. See docs/staff-mfa-recovery.md.
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

      {!error && staff === null && <Skeleton className="h-64 w-full" />}

      {staff !== null && (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Active" value={counts.active} onClick={() => setFilter("active")} />
            <Stat label="Suspended" value={counts.suspended} onClick={() => setFilter("suspended")} />
            <Stat label="Two-factor not set up" value={counts.noTwoFactor} warn={counts.noTwoFactor > 0} onClick={() => setFilter("attention")} />
            <Stat label="No sign-in for 90 days" value={counts.dormant} warn={counts.dormant > 0} onClick={() => setFilter("attention")} />
            <Stat label="Awaiting approval" value={pending.length} />
          </dl>

          {staff.length === 0 ? (
            <EmptyState title="No staff accounts yet" description="Invite the first Birr staff member above." />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Input aria-label="Search staff" placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-64" />
                <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-full sm:w-52">
                  <option value="all">Everyone</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="attention">Needs attention</option>
                </Select>
                <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as BirrStaffRole | "")} className="w-full sm:w-56">
                  <option value="">Any role</option>
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-slate-500 sm:ml-auto">
                  {visible.length} of {staff.length}
                </span>
              </div>

              {visible.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">No staff match.</p>
              ) : (
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {page.visible.map((s) => {
                    const waiting = pendingFor(s.id);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setOpenId(s.id)}
                          className="grid w-full gap-2 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">
                              {s.user.fullName}
                              {s.id === me?.id && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}
                            </span>
                            <span className="block truncate text-xs text-slate-500">{s.user.email}</span>
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            {s.roles.map((r) => (
                              <span key={r} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">
                                {roleLabel(r)}
                              </span>
                            ))}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs md:justify-end">
                            {s.status === "suspended" && <Badge tone="neutral">Suspended</Badge>}
                            {s.status === "active" && !s.user.mfaEnabled && <Badge tone="warning">No two-factor</Badge>}
                            {isDormant(s) && <Badge tone="warning">No sign-in 90+ days</Badge>}
                            {waiting.length > 0 && <Badge tone="info">Awaiting: {waiting.map(describeChange).join(", ")}</Badge>}
                            <span className="text-slate-500">{signedInText(s.user.lastSignInAt)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <ShowMoreFooter shown={page.shown} total={page.total} pageSize={STAFF_PER_PAGE} noun="staff members" onShowMore={page.showMore} />
            </>
          )}

          {invitesAwaiting.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Invitations awaiting approval</h2>
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {invitesAwaiting.map((p) => (
                  <li key={p.id} className="px-5 py-3 text-sm">
                    <span className="font-medium text-slate-900">{p.email}</span> as {p.role ? roleLabel(p.role) : "—"}
                    <span className="block text-xs text-slate-500">
                      Proposed by {p.proposedBy ?? "—"} on {formatDate(p.proposedAt)}
                      {p.reason && ` · “${p.reason}”`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sentInvitations.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Invitations sent, not yet accepted</h2>
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {invitationPage.visible.map((inv) => (
                  <InvitationRow key={inv.id} invitation={inv} invitedBy={nameOfUser(inv.invitedBy)} canManage={can("staff.invitation_manage")} onChanged={load} />
                ))}
              </ul>
              <ShowMoreFooter shown={invitationPage.shown} total={invitationPage.total} pageSize={STAFF_PER_PAGE} noun="invitations" onShowMore={invitationPage.showMore} />
            </section>
          )}
        </>
      )}

      {open && <MemberPanel member={open} pending={pendingFor(open.id)} onClose={() => setOpenId(null)} onProposed={load} />}
    </div>
  );
}

function Stat({ label, value, warn, onClick }: { label: string; value: number; warn?: boolean; onClick?: () => void }) {
  const className = `rounded-xl border px-4 py-3 text-left ${warn ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`;
  const body = (
    <>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${warn ? "text-amber-700" : "text-slate-900"}`}>{value}</dd>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} transition-colors hover:border-primary-300`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<BirrStaffRole>("mutawalli_officer");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await proposeStaffChange("staff.invite", { email, staffRole: roleKey, reason: reason.trim() });
      setProposed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (proposed) {
    return (
      <Alert tone="success" title="Sent for approval" className="mb-6">
        A Board member or Compliance officer approves adding {email} as {roleLabel(roleKey)} on the Approvals page; the invitation is emailed once
        it&apos;s approved.{" "}
        <button type="button" className="font-medium underline" onClick={onInvited}>
          Done
        </button>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">Invite a staff member</p>
      {error && (
        <Alert tone="danger" title="Couldn't send for approval">
          {error}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="invite-email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <Input id="invite-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium text-slate-700">
            Role
          </label>
          <Select id="invite-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value as BirrStaffRole)} className="w-full">
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="invite-reason" className="text-sm font-medium text-slate-700">
          Why are they joining?
        </label>
        <textarea
          id="invite-reason"
          rows={2}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">A second person (Board or Compliance) approves every new staff member before the invitation is emailed.</p>
        <Button type="submit" disabled={submitting || reason.trim().length < REASON_MIN}>
          {submitting ? "Sending…" : "Send for approval"}
        </Button>
      </div>
    </form>
  );
}

function InvitationRow({ invitation, invitedBy, canManage, onChanged }: { invitation: Invitation; invitedBy: string; canManage: boolean; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setError(null);
    setBusy(true);
    try {
      const { emailSent } = await apiFetchJson<{ emailSent: boolean }>(`/invitations/${invitation.id}/resend-email`, { method: "POST" });
      if (!emailSent) throw new Error("The email couldn't be sent — check the Resend settings and try again.");
      setResent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setError(null);
    setBusy(true);
    try {
      await apiFetchJson(`/invitations/${invitation.id}/revoke`, { method: "POST" });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
      <div>
        <span className="font-medium text-slate-900">{invitation.email}</span> as {invitation.roleKey ? roleLabel(invitation.roleKey) : "—"}
        <span className="block text-xs text-slate-500">
          Invited by {invitedBy} · expires {formatDate(invitation.expiresAt)}
        </span>
        {error && <span className="block text-xs text-red-600">{error}</span>}
      </div>
      {canManage &&
        (confirming ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-slate-700">Revoke this invitation? The link stops working.</span>
            <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => void revoke()}>
              Revoke
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <span className="flex gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy || resent} onClick={() => void resend()}>
              {resent ? "Email sent" : "Resend email"}
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setConfirming(true)}>
              Revoke…
            </Button>
          </span>
        ))}
    </li>
  );
}
