"use client";

// Impact — every periodic update Birr staff have logged against any
// cause across this Founder's whole portfolio (see
// app/ops/waqfs/[id]/CauseImpactSection.tsx for where staff log these).
// Its own sidebar page rather than staying nested inside each waqf's
// Causes section — a Founder with more than one fund shouldn't have to
// visit each one separately to see what's actually been achieved.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { markNotificationsReadForEntity } from "../../../lib/notifications";
import type { CauseCategorySuggestion, PortfolioCauseImpactUpdate } from "../../../lib/types";
import { Alert, IconHeart, Input, Skeleton } from "@birr/ui";
import { GeometricPattern, PageHeader, Panel } from "../_components/ui";

export default function ImpactPage() {
  const [updates, setUpdates] = useState<PortfolioCauseImpactUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<PortfolioCauseImpactUpdate[]>("/cause-impact-updates")
      .then((data) => {
        if (!cancelled) setUpdates(data);
        // Fix for the notification read-state gap (see
        // lib/notifications.ts's own comment). cause_impact_update.logged's
        // linkUrl actually points to /portfolio/{waqfId}, but this page
        // renders the exact same CauseImpactUpdate rows (aggregated across
        // every waqf) — viewing the entity here is just as real a "viewed
        // it" as viewing it on the per-waqf page would be.
        data.forEach((u) => markNotificationsReadForEntity("CauseImpactUpdate", u.id));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment). cause_suggestion.reviewed
  // links here (there's nowhere more specific to send a founder once
  // their own suggestion is decided), even though this page otherwise
  // has nothing to do with CauseCategorySuggestion — fetched purely to
  // mark those notifications read, not for display.
  useEffect(() => {
    let cancelled = false;
    apiFetchJson<CauseCategorySuggestion[]>("/cause-category-suggestions")
      .then((data) => {
        if (cancelled) return;
        data.filter((s) => s.status !== "pending").forEach((s) => markNotificationsReadForEntity("CauseCategorySuggestion", s.id));
      })
      .catch(() => {});
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

  const causeCount = new Set((updates ?? []).map((u) => u.waqfCause.id)).size;
  const fundCount = new Set((updates ?? []).map((u) => u.waqfCause.waqf.id)).size;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Impact"
        title="What your endowments achieved"
        description="Progress reports Birr's team logs against each cause your Waqf Funds support — newest first."
      />

      {error && (
        <Alert tone="danger" title="Couldn't load impact updates" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && updates === null && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      )}

      {!error && updates !== null && updates.length === 0 && (
        <Panel className="relative overflow-hidden p-8 text-center sm:p-12">
          <GeometricPattern className="pointer-events-none absolute inset-0 h-full w-full text-primary-900/[0.035]" />
          <div className="relative">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
              <IconHeart className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-display text-xl font-medium text-slate-900">No impact reported yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              As your funds' causes make progress — scholarships awarded, boreholes drilled — Birr's team logs it here.
              You'll get a notification each time.
            </p>
          </div>
        </Panel>
      )}

      {!error && updates !== null && updates.length > 0 && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            {[
              { label: updates.length === 1 ? "Report" : "Reports", value: updates.length },
              { label: causeCount === 1 ? "Cause" : "Causes", value: causeCount },
              { label: fundCount === 1 ? "Fund" : "Funds", value: fundCount },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 shadow-sm">
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{s.value}</p>
                <p className="text-xs font-medium text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>

          <Input
            type="search"
            placeholder="Search by fund, cause, period, or update…"
            aria-label="Search impact updates"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-5 sm:max-w-sm"
          />

          {visibleUpdates.length === 0 ? (
            <p className="text-sm text-slate-500">No updates match "{search.trim()}".</p>
          ) : (
            <div className="space-y-4">
              {visibleUpdates.map((u) => (
                <article key={u.id} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-800 ring-1 ring-inset ring-accent-200">
                          {u.periodLabel}
                        </span>
                        <span className="text-xs text-slate-500">{formatDate(u.createdAt)}</span>
                      </div>
                      <h2 className="mt-2.5 text-base font-semibold text-slate-900">{u.waqfCause.name}</h2>
                      <Link href={`/portfolio/${u.waqfCause.waqf.id}`} className="text-xs font-medium text-primary-700 hover:text-primary-800">
                        {u.waqfCause.waqf.name}
                      </Link>
                      <p className="mt-3 text-sm leading-relaxed text-slate-700">{u.narrative}</p>
                    </div>
                    {u.metricValue !== null && (
                      <div className="shrink-0 rounded-xl bg-primary-900 px-5 py-4 text-white sm:min-w-[9rem] sm:text-right">
                        <p className="font-display text-3xl font-medium tabular-nums">{u.metricValue.toLocaleString("en-NG")}</p>
                        <p className="mt-0.5 text-xs text-primary-100/80">{u.metricLabel ?? "Reported"}</p>
                      </div>
                    )}
                  </div>
                  <p className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-xs text-slate-500">
                    Reported by {u.reportedByUser.fullName}, Birr
                  </p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
