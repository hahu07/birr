"use client";

// Impact — every periodic update Birr staff have logged against any
// cause across this Founder's whole portfolio (see
// app/ops/waqfs/[id]/CauseImpactSection.tsx for where staff log these).
// Its own sidebar page rather than staying nested inside each waqf's
// Causes section — a Founder with more than one fund shouldn't have to
// visit each one separately to see what's actually been achieved.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import type { PortfolioCauseImpactUpdate } from "../../../lib/types";
import { Alert, EmptyState, IconCheckCircle, Input, Skeleton, StatCard } from "@birr/ui";

export default function ImpactPage() {
  const [updates, setUpdates] = useState<PortfolioCauseImpactUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<PortfolioCauseImpactUpdate[]>("/cause-impact-updates")
      .then((data) => {
        if (!cancelled) setUpdates(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = search.trim().toLowerCase();
  const visibleUpdates =
    updates?.filter(
      (u) =>
        !query ||
        u.waqfCause.waqf.name.toLowerCase().includes(query) ||
        u.waqfCause.name.toLowerCase().includes(query) ||
        u.periodLabel.toLowerCase().includes(query) ||
        u.narrative.toLowerCase().includes(query),
    ) ?? [];

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconCheckCircle className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Impact</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            What your endowments have actually achieved, reported by Birr's staff.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load impact updates">
          {error}
        </Alert>
      )}

      {!error && updates === null && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!error && updates !== null && updates.length === 0 && (
        <EmptyState
          title="No impact reported yet"
          description="Birr staff log these periodically as your waqf funds' causes make progress — check back later."
        />
      )}

      {!error && updates !== null && updates.length > 0 && (
        <Input
          placeholder="Search by fund, cause, period, or update…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-xs"
        />
      )}

      {!error && updates !== null && updates.length > 0 && visibleUpdates.length === 0 && (
        <p className="text-sm text-slate-500">No updates match "{search.trim()}".</p>
      )}

      {!error && visibleUpdates.length > 0 && (
        <div className="space-y-3">
          {visibleUpdates.map((u) => (
            <div key={u.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {u.waqfCause.waqf.name} · {u.waqfCause.name} · {u.periodLabel}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{u.narrative}</p>
                </div>
                {u.metricValue !== null && (
                  <StatCard label={u.metricLabel ?? "Reported"} value={u.metricValue} tone="primary" />
                )}
              </div>
              <p className="mt-2 text-xs text-slate-400">{formatDate(u.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
