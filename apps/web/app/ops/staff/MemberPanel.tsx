"use client";

// One staff member: who they are, what they hold, and the changes that can
// be proposed for them, each with a reason and a confirm step naming the
// effect and who must approve (2026-11-16). Nothing here changes anyone's
// access: a Board member or Compliance officer approves every change on the
// Approvals page. Staff managers also see the person's history.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { BirrStaff, BirrStaffRole, StaffChangeEntry } from "../../../lib/ops-types";
import { Alert, Badge, Button, Select } from "@birr/ui";
import { CHANGE_LABEL, REASON_MIN, STAFF_ROLES, describeChange, isDormant, proposeStaffChange, roleLabel, signedInText } from "./staff-helpers";

type Action = "role_add" | "role_remove" | "mfa_reset" | "suspend" | "reinstate";

const textareaClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export function MemberPanel({
  member,
  pending,
  onClose,
  onProposed,
}: {
  member: BirrStaff;
  pending: StaffChangeEntry[];
  onClose: () => void;
  onProposed: () => void;
}) {
  const { staff: me, can } = useStaffSession();
  const isMe = me?.id === member.id;
  const [action, setAction] = useState<Action | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [history, setHistory] = useState<StaffChangeEntry[] | null>(null);
  const canSeeHistory = can("roles.view");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!canSeeHistory) return;
    let cancelled = false;
    apiFetchJson<StaffChangeEntry[]>(`/birr-staff/${member.id}/history`)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [member.id, canSeeHistory, sent]);

  const addable = member.roles.includes("external_auditor") ? [] : STAFF_ROLES.filter((r) => !member.roles.includes(r) && r !== "external_auditor");
  const active = member.status === "active";
  const actions: { key: Action; label: string; allowed: boolean; danger?: boolean }[] = [
    { key: "role_add", label: "Add a role", allowed: can("staff.role_add") && active && addable.length > 0 },
    { key: "role_remove", label: "Remove a role", allowed: can("staff.role_remove") && active && member.roles.length > 1 },
    { key: "mfa_reset", label: "Reset two-factor", allowed: can("staff.mfa_reset") && active && member.user.mfaEnabled, danger: true },
    { key: "suspend", label: "Suspend", allowed: can("staff.suspend") && active, danger: true },
    { key: "reinstate", label: "Reinstate", allowed: can("staff.reinstate") && member.status === "suspended" },
  ];
  const offered = actions.filter((a) => a.allowed);
  const blocked = isMe ? "You can't propose changes to your own account; another staff member has to." : pending.length ? "A change for this person is awaiting approval. It has to be decided first." : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-title"
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h2 id="member-title" className="text-lg font-semibold text-slate-900">
              {member.user.fullName}
              {isMe && <span className="ml-2 text-sm font-normal text-slate-500">(you)</span>}
            </h2>
            <p className="text-sm text-slate-500">{member.user.email}</p>
          </div>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onClose}>
            Close
          </Button>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-5 py-4 text-sm sm:px-6">
          <dt className="text-slate-500">Roles</dt>
          <dd className="flex flex-wrap gap-1.5">
            {member.roles.map((r) => (
              <span key={r} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">
                {roleLabel(r)}
              </span>
            ))}
          </dd>
          <dt className="text-slate-500">Status</dt>
          <dd>
            <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Suspended"}</Badge>
          </dd>
          <dt className="text-slate-500">Two-factor</dt>
          <dd>{member.user.mfaEnabled ? "Set up" : <span className="font-medium text-amber-700">Not set up</span>}</dd>
          <dt className="text-slate-500">Last sign-in</dt>
          <dd className={isDormant(member) ? "font-medium text-amber-700" : undefined}>
            {signedInText(member.user.lastSignInAt)}
            {isDormant(member) && " · not signed in for 90+ days"}
          </dd>
          <dt className="text-slate-500">Joined</dt>
          <dd>{formatDate(member.createdAt)}</dd>
        </dl>

        {pending.length > 0 && (
          <div className="px-5 sm:px-6">
            <Alert tone="warning" title="Awaiting approval">
              {pending.map((p) => `${describeChange(p)} — proposed by ${p.proposedBy ?? "—"}`).join("; ")}.
            </Alert>
          </div>
        )}

        {offered.length > 0 && (
          <section className="border-t border-slate-100 px-5 py-4 sm:px-6">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Propose a change</h3>
            {sent && (
              <Alert tone="success" title="Sent for approval" className="mb-3">
                {sent}
              </Alert>
            )}
            {blocked ? (
              <p className="text-sm text-slate-600">{blocked}</p>
            ) : action ? (
              <ActionForm
                member={member}
                action={action}
                addable={addable}
                onCancel={() => setAction(null)}
                onSent={(message) => {
                  setAction(null);
                  setSent(message);
                  onProposed();
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {offered.map((a) => (
                  <Button key={a.key} variant={a.danger ? "danger" : "secondary"} className="px-3 py-1.5 text-xs" onClick={() => setAction(a.key)}>
                    {a.label}…
                  </Button>
                ))}
              </div>
            )}
          </section>
        )}

        {canSeeHistory && (
          <section className="border-t border-slate-100 px-5 py-4 sm:px-6">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">History</h3>
            {history === null ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-slate-500">No recorded changes.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{describeChange(h)}</span>
                      <Badge tone={h.status === "approved" ? "success" : h.status === "proposed" ? "warning" : "neutral"}>
                        {h.status === "proposed" ? "Awaiting approval" : h.status === "approved" ? "Approved" : h.status === "rejected" ? "Rejected" : "Expired"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {CHANGE_LABEL[h.kind]} proposed by {h.proposedBy ?? "—"} on {formatDate(h.proposedAt)}
                      {h.decidedAt && ` · decided by ${h.decidedBy ?? "—"} on ${formatDate(h.decidedAt)}`}
                    </p>
                    {h.reason ? <p className="mt-1.5 text-slate-700">“{h.reason}”</p> : <p className="mt-1.5 text-xs text-slate-400">No reason recorded.</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

const EFFECT: Record<Action, (name: string) => string> = {
  role_add: (name) => `${name} gains everything the role allows.`,
  role_remove: (name) => `${name} loses everything the role allowed, unless another of their roles allows it.`,
  mfa_reset: (name) =>
    `${name}'s authenticator and backup codes stop working; they set two-factor up again at their next sign-in. Confirm this request with ${name} through a separate channel (a call to a number you already have) before sending.`,
  suspend: (name) => `${name} is signed out on their next click and can't sign in until reinstated.`,
  reinstate: (name) => `${name} can sign in again with their existing roles.`,
};

function ActionForm({
  member,
  action,
  addable,
  onCancel,
  onSent,
}: {
  member: BirrStaff;
  action: Action;
  addable: BirrStaffRole[];
  onCancel: () => void;
  onSent: (message: string) => void;
}) {
  const name = member.user.fullName;
  const roleChoices = action === "role_add" ? addable : action === "role_remove" ? member.roles : [];
  const [role, setRole] = useState<BirrStaffRole | "">("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsRole = action === "role_add" || action === "role_remove";
  const ready = (!needsRole || role) && reason.trim().length >= REASON_MIN && !submitting;
  const title =
    action === "role_add" ? `Add a role to ${name}` :
    action === "role_remove" ? `Remove a role from ${name}` :
    action === "mfa_reset" ? `Reset ${name}'s two-factor` :
    action === "suspend" ? `Suspend ${name}` : `Reinstate ${name}`;

  async function send() {
    setSubmitting(true);
    setError(null);
    try {
      const key = action === "role_add" || action === "role_remove" ? `staff.${action}` : action === "mfa_reset" ? "staff.mfa_reset" : `staff.${action}`;
      await proposeStaffChange(key, { staffId: member.id, ...(needsRole && { role }), reason: reason.trim() });
      onSent(`${title}${needsRole && role ? `: ${roleLabel(role)}` : ""}. A Board member or Compliance officer approves it on the Approvals page; nothing changes until then.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4" role="group" aria-label={title}>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {needsRole && (
        <div>
          <label htmlFor="action-role" className="mb-1 block text-xs font-medium text-slate-700">
            Role
          </label>
          <Select id="action-role" value={role} onChange={(e) => setRole(e.target.value as BirrStaffRole)} className="w-full">
            <option value="">Choose a role…</option>
            {roleChoices.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </div>
      )}
      <p className="text-sm text-slate-700">{EFFECT[action](name)}</p>
      <div>
        <label htmlFor="action-reason" className="mb-1 block text-xs font-medium text-slate-700">
          Why?
        </label>
        <textarea id="action-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
        <p className="mt-1 text-xs text-slate-500">The approver reads this first, and it&apos;s kept in the audit trail. At least {REASON_MIN} characters.</p>
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't send for approval">
          {error}
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button variant={action === "mfa_reset" || action === "suspend" || action === "role_remove" ? "danger" : "primary"} className="px-3 py-1.5 text-xs" disabled={!ready} onClick={() => void send()}>
          {submitting ? "Sending…" : "Send for approval"}
        </Button>
      </div>
    </div>
  );
}
