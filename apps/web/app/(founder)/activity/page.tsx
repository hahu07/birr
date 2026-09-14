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
import { formatDate } from "../../../lib/format";
import type { FounderAuditLogEntry, FounderAuditLogPage } from "../../../lib/types";
import { Alert, Button, EmptyState, IconClock, Skeleton } from "@birr/ui";

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
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconClock className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Your activity</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Every action your team has taken — allocations, cause selection, deed signings, invitations — newest
            first.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load your activity" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && entries === null && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!error && entries !== null && entries.length === 0 && (
        <EmptyState title="No activity yet" description="Actions you and your team take will show up here." />
      )}

      {!error && entries !== null && entries.length > 0 && (
        <>
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm"
              >
                <div>
                  <span className="font-medium text-slate-900">{entry.action}</span>
                  {entry.actorUser && <span className="text-slate-500"> · {entry.actorUser.fullName}</span>}
                </div>
                <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(entry.createdAt)}</span>
              </div>
            ))}
          </div>

          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
