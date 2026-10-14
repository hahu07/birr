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
import { markNotificationsReadForEntity } from "../../../lib/notifications";
import type { FounderMembership, Invitation } from "../../../lib/types";
import { Alert, Badge, Button, IconPlus, Select, Skeleton } from "@birr/ui";
import { linkButton, PageHeader, Panel, PanelHeader } from "../_components/ui";
import { Field, inputClass } from "../_components/form";

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

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers founder_membership.joined
  // and invitation.sent, both of which link here.
  useEffect(() => {
    members?.forEach((m) => markNotificationsReadForEntity("FounderMembership", m.id));
    pendingInvitations.forEach((i) => markNotificationsReadForEntity("Invitation", i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, invitations]);

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Who has access"
        description="People who can sign in to your Founder account, and what each of them can do."
        actions={
          isPrimaryContact && (
            <button type="button" className={showInviteForm ? linkButton.secondary : linkButton.primary} onClick={() => setShowInviteForm((v) => !v)} aria-expanded={showInviteForm}>
              {showInviteForm ? (
                "Cancel"
              ) : (
                <>
                  <IconPlus className="h-4 w-4" />
                  Invite someone
                </>
              )}
            </button>
          )
        }
      />

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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title="Members" aside={members && <span className="text-xs text-slate-500">{members.length}</span>} />
            {!error && members === null && (
              <div className="space-y-3 p-5">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}
            {!error && members !== null && members.length === 0 && (
              <p className="px-5 py-6 text-sm text-slate-500">No team members yet — invite a colleague to give them access.</p>
            )}
            {!error && members !== null && members.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-300 to-accent-500 text-xs font-bold text-accent-950">
                      {initialsOf(m.user.fullName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {m.user.fullName} {m.user.id === user?.id && <span className="font-normal text-slate-500">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">{m.user.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={m.permissionLevel === "primary_contact" ? "success" : "neutral"}>{humanize(m.permissionLevel)}</Badge>
                      {m.status !== "active" && <Badge tone="neutral">{humanize(m.status)}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {!error && pendingInvitations.length > 0 && (
            <Panel>
              <PanelHeader title="Pending invitations" aside={<span className="text-xs text-slate-500">{pendingInvitations.length}</span>} />
              <div className="space-y-2 p-4">
                {pendingInvitations.map((inv) => (
                  <PendingInvitationRow key={inv.id} invitation={inv} canRevoke={Boolean(isPrimaryContact)} onRevoked={load} />
                ))}
              </div>
            </Panel>
          )}
        </div>

        <Panel className="h-fit">
          <PanelHeader title="Roles" />
          <dl className="divide-y divide-slate-100">
            {ROLE_OPTIONS.map((role) => (
              <div key={role} className="px-5 py-3.5">
                <dt className="text-sm font-semibold text-slate-900">{humanize(role)}</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-slate-500">{ROLE_DESCRIPTION[role]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

// Same wording the invite form always showed, now in the Roles panel
// beside the member list so it's visible without opening the form.
const ROLE_DESCRIPTION: Record<FounderMembership["permissionLevel"], string> = {
  viewer: "Can see your portfolio.",
  requester: "Can also suggest causes and select or unselect them.",
  primary_contact: "Full access, including inviting others.",
};

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
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
      <div className="mb-6 rounded-2xl border border-primary-200 bg-primary-50 p-5">
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
    <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Invite someone</h2>
      <p className="mt-0.5 text-sm text-slate-500">They'll get an email with a link to create their sign-in.</p>
      {error && (
        <Alert tone="danger" title="Couldn't send invitation" className="mt-4">
          {error}
        </Alert>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Email" htmlFor="invite-email">
          <input
            id="invite-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value as FounderMembership["permissionLevel"])}>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {humanize(role)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">{ROLE_DESCRIPTION[roleKey]}</p>
      <div className="mt-5 flex justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onCancel} className="rounded-lg">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} className="rounded-lg font-semibold">
          {submitting ? "Sending…" : "Send invite"}
        </Button>
      </div>
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
  const [copied, setCopied] = useState(false);
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
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
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
            onClick={() =>
              navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            {copied ? "Copied" : "Copy link"}
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
