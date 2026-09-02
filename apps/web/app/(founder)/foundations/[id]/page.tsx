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
import type { Foundation, FounderMembership, Invitation } from "../../../../lib/types";
import { Alert, Badge, Button, EmptyState, IconLandmark, Skeleton } from "@birr/ui";
import { InviteCoFounderForm } from "./InviteCoFounderForm";
import { MessagesSection } from "./MessagesSection";

export default function FoundationDetailPage() {
  const params = useParams<{ id: string }>();
  const foundationId = params.id;
  const { user } = useFounderSession();

  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [members, setMembers] = useState<FounderMembership[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<Foundation>(`/foundations/${foundationId}`),
      apiFetchJson<FounderMembership[]>("/founders/me/members"),
      apiFetchJson<Invitation[]>("/invitations"),
    ])
      .then(([foundationData, membersData, invitationsData]) => {
        setFoundation(foundationData);
        setMembers(membersData);
        setInvitations(invitationsData);
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
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconLandmark className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{foundation?.name ?? "Foundation"}</h1>
            {foundation && (foundation.purpose || foundation.jurisdiction) && (
              <p className="mt-0.5 text-sm text-slate-500">
                {[foundation.purpose, foundation.jurisdiction].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {foundation?.foundationDeed && (
            <Link href={`/foundations/${foundationId}/deed`}>
              <Button variant="secondary">View signed deed</Button>
            </Link>
          )}
          {isPrimaryContact && (
            <Button variant="secondary" onClick={() => setShowInviteForm((v) => !v)}>
              {showInviteForm ? "Cancel" : "Invite a co-founder"}
            </Button>
          )}
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load this Foundation" className="mb-6">
          {error}
        </Alert>
      )}

      {isPrimaryContact && showInviteForm && (
        <InviteCoFounderForm
          foundationId={foundationId}
          onInvited={() => {
            setShowInviteForm(false);
            load();
          }}
          onCancel={() => setShowInviteForm(false)}
        />
      )}

      {!error && foundation === null && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {!error && foundation !== null && (
        <>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Co-founders</p>
          <div className="space-y-1.5">
            {(foundation.foundationFounders ?? []).map((ff) => (
              <div
                key={ff.founder.id}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3"
              >
                <p className="text-sm font-medium text-slate-900">{ff.founder.name}</p>
                <Badge tone="neutral">Co-founder</Badge>
              </div>
            ))}
          </div>

          {pendingCoFounderInvitations.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Pending co-founder invitations
              </p>
              <div className="space-y-1.5">
                {pendingCoFounderInvitations.map((inv) => (
                  <PendingCoFounderInvitationRow
                    key={inv.id}
                    invitation={inv}
                    canRevoke={Boolean(isPrimaryContact)}
                    onRevoked={load}
                  />
                ))}
              </div>
            </div>
          )}

          {(foundation.foundationFounders ?? []).length === 0 && (
            <EmptyState title="No founders on record" description="This Foundation has no Founder attached yet." />
          )}

          <MessagesSection foundationId={foundationId} />
        </>
      )}
    </div>
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
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{invitation.email}</p>
          <p className="text-xs text-slate-500">Expires {formatDate(invitation.expiresAt)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => navigator.clipboard.writeText(link)}>
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
