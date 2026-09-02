"use client";

// Founder-facing, read-only — decided (approved/rejected) governance
// actions Birr staff have taken on this waqf: asset disposal,
// distribution approval, investment changes, beneficiary-criteria
// updates. Nothing pending shows here (a proposal could still be
// rejected, so there's nothing final yet to tell a Founder), and no raw
// payload — see GovernanceActivity's own comment on why this stays a
// summary of *that a decision happened*, not its internal details.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, humanizePermissionKey } from "../../../../lib/format";
import { markNotificationsReadForEntity } from "../../../../lib/notifications";
import type { WaqfGovernanceActivity } from "../../../../lib/types";
import { Alert, Badge, Skeleton } from "@birr/ui";

export function GovernanceActivitySection({ waqfId }: { waqfId: string }) {
  const [activity, setActivity] = useState<WaqfGovernanceActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<WaqfGovernanceActivity[]>(`/governed-actions?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setActivity(data);
        // Fix for the notification read-state gap (see
        // lib/notifications.ts's own comment) — covers
        // governed_action.decided, which links to this waqf's page.
        data.forEach((a) => markNotificationsReadForEntity("GovernedAction", a.id));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Governance activity</p>
      <p className="mb-3 text-sm text-slate-500">Decisions Birr's staff have made on this fund.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load governance activity">
          {error}
        </Alert>
      )}

      {!error && activity === null && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {!error && activity !== null && activity.length === 0 && (
        <p className="text-sm text-slate-500">No decisions recorded yet.</p>
      )}

      {!error && activity !== null && activity.length > 0 && (
        <div className="space-y-1.5">
          {activity.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <div>
                <span className="font-medium text-slate-900">{humanizePermissionKey(a.permission.key)}</span>
                {a.checkerUser && <span className="text-slate-500"> · reviewed by {a.checkerUser.fullName}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={a.status === "approved" ? "success" : "danger"}>
                  {a.status === "approved" ? "Approved" : "Rejected"}
                </Badge>
                <span className="whitespace-nowrap text-xs text-slate-400">
                  {a.decidedAt ? formatDate(a.decidedAt) : formatDate(a.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
