"use client";

// Foundation detail — Co-founders (separate Founder entities jointly
// establishing this Foundation, via foundation_founders) plus pending
// co-founder invitations. Distinct from /team, which is about
// teammates (FounderMembership) under the CURRENT Founder, not other
// Founder entities sharing this Foundation. Any active member of any
// attached Founder can view; only a primary_contact can invite (backend:
// InvitationsController's assertPrimaryContact) — same posture as
// team/page.tsx, this page just hides the control a non-primary-contact
// viewer would get a 403 from anyway.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useFounderSession } from "../../../../lib/founder-session";
import { markNotificationsReadForEntity } from "../../../../lib/notifications";
import type { Foundation, FounderMembership, Invitation, Waqf } from "../../../../lib/types";
import { Alert, Badge, Button, IconCheckCircle, IconFileText, IconPlus, IconUsers, Skeleton } from "@birr/ui";
import { FundRow, linkButton, PageHeader, Panel, PanelHeader } from "../../_components/ui";
import { InviteCoFounderForm } from "./InviteCoFounderForm";
import { MessagesSection } from "./MessagesSection";

export default function FoundationDetailPage() {
  const params = useParams<{ id: string }>();
  const foundationId = params.id;
  const { user } = useFounderSession();

  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [members, setMembers] = useState<FounderMembership[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<Foundation>(`/foundations/${foundationId}`),
      apiFetchJson<FounderMembership[]>("/founders/me/members"),
      apiFetchJson<Invitation[]>("/invitations"),
      apiFetchJson<Waqf[]>("/waqfs"),
    ])
      .then(([foundationData, membersData, invitationsData, waqfsData]) => {
        setFoundation(foundationData);
        setMembers(membersData);
        setInvitations(invitationsData);
        // GET /waqfs is already founder-scoped; this page shows just the
        // funds under this one Foundation (2026-10 redesign — they
        // weren't listed here at all before).
        setWaqfs(waqfsData.filter((w) => w.foundationId === foundationId));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [foundationId]);

  useEffect(() => {
    load();
  }, [load]);

  // Whether the CURRENT session's own Founder is a primary_contact — the
  // gate for sending a new co-founder invite, same computation
  // team/page.tsx already uses for its own "Invite someone" control.
  const isPrimaryContact = members?.some((m) => m.user.id === user?.id && m.permissionLevel === "primary_contact");
  const pendingCoFounderInvitations =
    invitations?.filter((i) => i.status === "pending" && i.inviteeKind === "co_founder" && i.foundationId === foundationId) ?? [];

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers
  // foundation.co_founder_joined, whose relatedEntityId is this same
  // "foundationId:founderId" composite key (see InvitationsService's own
  // notify() call).
  useEffect(() => {
    (foundation?.foundationFounders ?? []).forEach((ff) =>
      markNotificationsReadForEntity("FoundationFounder", `${foundationId}:${ff.founder.id}`),
    );
  }, [foundation, foundationId]);

  return (
    <div>
      <PageHeader
        back={{ href: "/portfolio", label: "Portfolio" }}
        eyebrow="Foundation"
        title={foundation?.name ?? "Foundation"}
        description={foundation && (foundation.purpose || foundation.jurisdiction) ? [foundation.purpose, foundation.jurisdiction].filter(Boolean).join(" · ") : undefined}
        actions={
          <>
            {isPrimaryContact && (
              <button type="button" className={linkButton.secondary} onClick={() => setShowInviteForm((v) => !v)} aria-expanded={showInviteForm}>
                <IconUsers className="h-4 w-4" />
                {showInviteForm ? "Cancel invite" : "Invite a co-founder"}
              </button>
            )}
            <Link href={`/foundations/${foundationId}/waqf-funds/new`} className={linkButton.primary}>
              <IconPlus className="h-4 w-4" />
              Add Waqf Fund
            </Link>
          </>
        }
      />

      {error && (
        <Alert tone="danger" title="Couldn't load this Foundation" className="mb-6">
          {error}
        </Alert>
      )}

      {isPrimaryContact && showInviteForm && (
        <div className="mb-6">
          <InviteCoFounderForm
            foundationId={foundationId}
            onInvited={() => {
              setShowInviteForm(false);
              load();
            }}
            onCancel={() => setShowInviteForm(false)}
          />
        </div>
      )}

      {!error && foundation === null && (
        <div className="grid gap-6 lg:grid-cols-3" aria-busy="true">
          <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      )}

      {!error && foundation !== null && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Panel>
              <PanelHeader
                title="Waqf Funds"
                aside={waqfs && <span className="text-xs text-slate-500">{waqfs.length} {waqfs.length === 1 ? "fund" : "funds"}</span>}
              />
              {waqfs === null ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : waqfs.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-slate-600">No Waqf Fund under this Foundation yet.</p>
                  <Link href={`/foundations/${foundationId}/waqf-funds/new`} className={`${linkButton.primary} mt-4`}>
                    <IconPlus className="h-4 w-4" />
                    Add the first Waqf Fund
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {waqfs.map((w) => (
                    <li key={w.id}>
                      <FundRow waqf={w} showFoundation={false} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <MessagesSection foundationId={foundationId} />
          </div>

          <div className="space-y-6">
            <DeedPanel foundation={foundation} />

            <Panel>
              <PanelHeader title="Co-founders" />
              {(foundation.foundationFounders ?? []).length === 0 ? (
                <p className="px-5 py-5 text-sm text-slate-500">This Foundation has no Founder attached yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {(foundation.foundationFounders ?? []).map((ff) => (
                    <li key={ff.founder.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-800">
                        {ff.founder.name.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{ff.founder.name}</span>
                      <Badge tone="neutral">Co-founder</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {pendingCoFounderInvitations.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pending invitations</p>
                  <div className="space-y-2">
                    {pendingCoFounderInvitations.map((inv) => (
                      <PendingCoFounderInvitationRow key={inv.id} invitation={inv} canRevoke={Boolean(isPrimaryContact)} onRevoked={load} />
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Deed status for this Foundation. Always shown, signed or not —
 * 2026-09-14 audit fix: when unsigned, this used to render nothing at
 * all, so a Founder had no way to discover signing was possible for any
 * Foundation past their first (the onboarding wizard only covers
 * foundations[0]). Anyone can see the CTA; the deed page itself gates the
 * actual form to the primary contact.
 */
function DeedPanel({ foundation }: { foundation: Foundation }) {
  const deed = foundation.foundationDeed;
  return (
    <Panel className={deed ? "" : "border-accent-200 bg-accent-50/40"}>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${deed ? "bg-primary-50 text-primary-700" : "bg-accent-100 text-accent-700"}`}
          >
            {deed ? <IconCheckCircle className="h-5 w-5" /> : <IconFileText className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Foundation Deed</p>
            <p className="text-xs text-slate-500">{deed ? `Signed ${formatDate(deed.signedAt)} by ${deed.typedLegalName}` : "Not signed yet"}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          One deed appoints Birr as Mutawalli (trustee) for this Foundation and every Waqf Fund under it, present and future.
        </p>
        <Link
          href={`/foundations/${foundation.id}/deed`}
          className={`${deed ? linkButton.secondary : linkButton.primary} mt-4 w-full px-3 py-2 text-xs`}
        >
          {deed ? "View signed deed" : "Review & sign the deed"}
        </Link>
      </div>
    </Panel>
  );
}

function PendingCoFounderInvitationRow({
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

  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/ops/accept-invitation?token=${invitation.token}&kind=co_founder`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{invitation.email}</p>
          <p className="text-xs text-slate-500">Expires {formatDate(invitation.expiresAt)}</p>
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
