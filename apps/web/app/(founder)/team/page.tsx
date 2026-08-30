"use client";

// Team — who has access to this Founder's account. Any active member
// can view this page; only the primary contact can invite or revoke
// (see InvitationsController's assertPrimaryContact checks on the
// backend — this page just hides the controls a non-primary-contact
// viewer would get a 403 from anyway, same posture as the Jurisdictions
// page's own role-gated form).
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import { useFounderSession } from "../../../lib/founder-session";
import type { FounderMembership, Invitation } from "../../../lib/types";
import { Alert, Badge, Button, EmptyState, IconUsers, Input, Skeleton } from "@birr/ui";

const ROLE_OPTIONS: FounderMembership["permissionLevel"][] = ["viewer", "requester", "primary_contact"];

export default function TeamPage() {
  const { user } = useFounderSession();
  const [members, setMembers] = useState<FounderMembership[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<FounderMembership[]>("/founders/me/members"),
      apiFetchJson<Invitation[]>("/invitations"),
    ])
      .then(([membersData, invitationsData]) => {
        setMembers(membersData);
        setInvitations(invitationsData);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isPrimaryContact = members?.some((m) => m.user.id === user?.id && m.permissionLevel === "primary_contact");
  const pendingInvitations = invitations?.filter((i) => i.status === "pending") ?? [];

  return (
    <div>
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconUsers className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team</h1>
            <p className="mt-0.5 text-sm text-slate-500">Who has access to your Foundation's account.</p>
          </div>
        </div>
        {isPrimaryContact && (
          <Button variant="secondary" onClick={() => setShowInviteForm((v) => !v)}>
            {showInviteForm ? "Cancel" : "Invite someone"}
          </Button>
        )}
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load your team" className="mb-6">
          {error}
        </Alert>
      )}

      {isPrimaryContact && showInviteForm && (
        <InviteForm
          onInvited={() => {
            setShowInviteForm(false);
            load();
          }}
          onCancel={() => setShowInviteForm(false)}
        />
      )}

      {!error && members === null && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {!error && members !== null && members.length > 0 && (
        <div className="space-y-1.5">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {m.user.fullName} {m.user.id === user?.id && <span className="font-normal text-slate-400">(you)</span>}
                </p>
                <p className="text-xs text-slate-500">{m.user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{humanize(m.permissionLevel)}</Badge>
                <Badge tone={m.status === "active" ? "success" : "neutral"}>{humanize(m.status)}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {!error && pendingInvitations.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Pending invitations</p>
          <div className="space-y-1.5">
            {pendingInvitations.map((inv) => (
              <PendingInvitationRow key={inv.id} invitation={inv} canRevoke={Boolean(isPrimaryContact)} onRevoked={load} />
            ))}
          </div>
        </div>
      )}

      {!error && members !== null && members.length === 0 && (
        <EmptyState title="No team members yet" description="Invite a colleague to give them access to this account." />
      )}
    </div>
  );
}

function InviteForm({ onInvited, onCancel }: { onInvited: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<FounderMembership["permissionLevel"]>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Invitation | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const invitation = await apiFetchJson<Invitation>("/invitations", {
        method: "POST",
        body: JSON.stringify({ inviteeKind: "founder_user", email: email.trim(), roleKey }),
      });
      setSent(invitation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/ops/accept-invitation?token=${sent.token}`;
    return (
      <div className="mb-6 rounded-lg border border-primary-200 bg-primary-50 p-4">
        {sent.emailSent ? (
          <p className="text-sm font-medium text-primary-900">Invitation emailed to {sent.email}.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-primary-900">
              Couldn&apos;t send the email automatically — copy this link and send it to {sent.email} yourself:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-primary-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
                {link}
              </code>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => navigator.clipboard.writeText(link)}
              >
                Copy
              </Button>
            </div>
          </>
        )}
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
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Email</label>
          <Input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
          />
        </div>
        <div className="min-w-[10rem] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Role</label>
          <select
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value as FounderMembership["permissionLevel"])}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {humanize(role)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send invite"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Viewer can see your portfolio; Requester can also suggest causes and select/unselect them; Primary contact has
        full access, including inviting others.
      </p>
    </form>
  );
}

function PendingInvitationRow({
  invitation,
  canRevoke,
  onRevoked,
}: {
  invitation: Invitation;
  canRevoke: boolean;
  onRevoked: () => void;
}) {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setError(null);
    setRevoking(true);
    try {
      await apiFetchJson(`/invitations/${invitation.id}/revoke`, { method: "POST" });
      onRevoked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setRevoking(false);
    }
  }

  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/ops/accept-invitation?token=${invitation.token}`;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{invitation.email}</p>
          <p className="text-xs text-slate-500">
            {humanize(invitation.roleKey)} · Expires {formatDate(invitation.expiresAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => navigator.clipboard.writeText(link)}
          >
            Copy link
          </Button>
          {canRevoke && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={revoking} onClick={handleRevoke}>
              {revoking ? "Revoking…" : "Revoke"}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
