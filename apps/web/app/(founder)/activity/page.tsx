"use client";

// Your activity — this Founder's own team's history across every
// Foundation/Waqf Fund they're part of (allocation changes, cause
// selection, deed signings, invitations, ...). Distinct from
// GovernanceActivitySection (per-waqf, shows Birr staff's *decisions*
// on that one fund) — this is the founder-team's own side of the
// ledger, account-wide, not staff's. Found missing entirely during a
// comprehensive Founder-side review, 2026-09-14: the underlying
// audit_logs rows were written every step of the way, but nothing in
// the Portal ever showed them back to the Founder who made them — a
// real gap on a platform whose whole pitch is an immutable audit trail.
// GET /audit-logs/me does the actual scoping (actorFounderId) and
// never returns raw before/after — see that route's own comment.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { describeAuditAction } from "../../../lib/format";
import type { FounderAuditLogEntry, FounderAuditLogPage } from "../../../lib/types";
import { Alert, Button, IconClock, Skeleton } from "@birr/ui";
import { PageHeader, Panel } from "../_components/ui";

export default function ActivityPage() {
  const [entries, setEntries] = useState<FounderAuditLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<FounderAuditLogPage>("/audit-logs/me")
      .then((page) => {
        if (cancelled) return;
        setEntries(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetchJson<FounderAuditLogPage>(`/audit-logs/me?cursor=${nextCursor}`);
      setEntries((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Activity"
        title="Your team's activity"
        description="Every action your team has taken — allocations, cause selection, deed signings, invitations — newest first. Each one is also recorded in Birr's immutable audit trail."
      />

      {error && (
        <Alert tone="danger" title="Couldn't load your activity" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && entries === null && <Skeleton className="h-64 w-full rounded-2xl" />}

      {!error && entries !== null && entries.length === 0 && (
        <Panel className="px-5 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            <IconClock className="h-6 w-6" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">No activity yet</p>
          <p className="mt-1 text-sm text-slate-500">Actions you and your team take will show up here.</p>
        </Panel>
      )}

      {!error && entries !== null && entries.length > 0 && (
        <div className="space-y-6">
          {groupByDay(entries).map(({ label, items }) => (
            <section key={label}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
              <Panel>
                <ol className="px-5 py-4">
                  {items.map((entry, i) => (
                    <li key={entry.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                      {i < items.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200" aria-hidden="true" />}
                      <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-primary-500 bg-white" aria-hidden="true" />
                      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                        <p className="text-sm text-slate-900">
                          <span className="font-medium">{describeAuditAction(entry.action)}</span>
                          {entry.actorUser && <span className="text-slate-500"> · {entry.actorUser.fullName}</span>}
                        </p>
                        <time dateTime={entry.createdAt} className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                          {new Date(entry.createdAt).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              </Panel>
            </section>
          ))}

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="secondary" disabled={loadingMore} onClick={loadMore} className="rounded-lg">
                {loadingMore ? "Loading…" : "Load older activity"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "Today" / "Yesterday" / "Monday, 12 October 2026" buckets, preserving the API's newest-first order. */
function groupByDay(entries: FounderAuditLogEntry[]): { label: string; items: FounderAuditLogEntry[] }[] {
  const dayKey = (d: Date) => d.toDateString();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups: { label: string; items: FounderAuditLogEntry[] }[] = [];
  for (const entry of entries) {
    const d = new Date(entry.createdAt);
    const label =
      dayKey(d) === dayKey(today)
        ? "Today"
        : dayKey(d) === dayKey(yesterday)
          ? "Yesterday"
          : d.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}
