"use client";

// Changes to what roles may do: those awaiting the Board, then every
// decided one, each with its reason, who proposed and who decided.
import { useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import type { RoleChangeEntry, RoleChanges, RolesOverview } from "../../../lib/ops-types";
import { permissionLabel, settingLabel, settingOf } from "../../../lib/permission-labels";
import { Badge, Button, Card, EmptyState } from "@birr/ui";

export function ChangesTab({ overview, changes, onChanges }: { overview: RolesOverview; changes: RoleChanges; onChanges: (next: RoleChanges) => void }) {
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await apiFetchJson<RoleChanges>(`/roles/changes?page=${changes.page + 1}`);
      onChanges({ ...next, pending: changes.pending, history: [...changes.history, ...next.history] });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Awaiting the Board</h2>
        {changes.pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-sm text-slate-500">Nothing awaiting approval.</p>
        ) : (
          <div className="space-y-3">
            {changes.pending.map((entry) => (
              <ChangeCard key={entry.id} entry={entry} overview={overview} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">History</h2>
        {changes.history.length === 0 ? (
          <EmptyState title="No decided changes yet" description="Approved and rejected changes to what roles may do appear here." />
        ) : (
          <div className="space-y-3">
            {changes.history.map((entry) => (
              <ChangeCard key={entry.id} entry={entry} overview={overview} />
            ))}
            {changes.hasMore && (
              <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show older changes"}
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const STATUS: Record<RoleChangeEntry["status"], { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  proposed: { label: "Awaiting the Board", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

function ChangeCard({ entry, overview }: { entry: RoleChangeEntry; overview: RolesOverview }) {
  const status = STATUS[entry.status] ?? STATUS.expired;
  const roleName = (key: string) => overview.roles.find((r) => r.key === key)?.name ?? key;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-slate-600">
            {entry.changes.length} {entry.changes.length === 1 ? "change" : "changes"} · proposed by{" "}
            <span className="font-medium text-slate-800">{entry.proposedBy ?? "—"}</span> on {formatDate(entry.proposedAt)}
          </span>
        </div>
        {entry.status === "proposed" ? (
          <Link href="/ops/governed-actions" className="text-sm font-medium text-primary-700 hover:text-primary-900">
            Open in Approvals
          </Link>
        ) : (
          entry.decidedAt && (
            <span className="text-xs text-slate-500">
              {entry.status === "approved" ? "Approved" : "Decided"} by {entry.decidedBy ?? "—"} on {formatDate(entry.decidedAt)}
            </span>
          )
        )}
      </div>
      {entry.reason ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-medium">Reason:</span> {entry.reason}
        </p>
      ) : (
        <p className="text-xs text-slate-500">Proposed before reasons were recorded.</p>
      )}
      <ul className="space-y-1 text-sm">
        {entry.changes.map((c) => {
          const permission = overview.permissions.find((p) => p.key === c.permissionKey);
          const approval = permission?.requiresMakerChecker ?? false;
          return (
            <li key={`${c.roleKey}:${c.permissionKey}`} className="flex flex-wrap gap-x-1.5 text-slate-700">
              <span className="font-medium text-slate-900">{roleName(c.roleKey)}</span>
              <span>·</span>
              <span>{permission ? permissionLabel(permission) : c.permissionKey}</span>
              <span>→</span>
              <span className="font-semibold">{settingLabel(settingOf(c, approval), approval)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
