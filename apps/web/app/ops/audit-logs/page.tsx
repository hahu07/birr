"use client";

// Audit Log viewer — the append-only audit_logs table (CLAUDE.md's
// cross-cutting non-negotiable: every write on a governed entity, plus
// every agent-initiated action, lands here). Read-only by design; there
// is no UPDATE/DELETE route because there's no UPDATE/DELETE grant on
// this table at the DB role level either.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import type { AuditLog, AuditLogPage } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconFileText,
  IconSparkle,
  IconUser,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const ACTOR_TONE: Record<AuditLog["actorType"], "success" | "info" | "neutral"> = {
  birr_staff: "success",
  founder_user: "neutral",
  ai_agent: "info",
  system: "neutral",
};

function actorLabel(log: AuditLog): string {
  if (log.actorUser) return log.actorUser.fullName;
  if (log.actorAgent) return log.actorAgent.name;
  if (log.actorFounder) return log.actorFounder.name;
  return "System";
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<AuditLogPage>("/audit-logs")
      .then((page) => {
        setLogs(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetchJson<AuditLogPage>(`/audit-logs?cursor=${nextCursor}`);
      setLogs((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  const visibleLogs = useMemo(() => {
    if (!logs) return null;
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q) ||
        actorLabel(l).toLowerCase().includes(q),
    );
  }, [logs, query]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconFileText className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Audit Log</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Newest first, append-only, never edited or deleted — load more to go further back.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load the audit log" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && logs === null && <AuditLogSkeleton />}

      {!error && logs !== null && logs.length === 0 && (
        <EmptyState title="No audit log entries yet" description="Governed and agent-initiated actions will appear here." />
      )}

      {!error && logs !== null && logs.length > 0 && (
        <>
          <div className="mb-4">
            <Input
              type="search"
              placeholder="Filter by action, entity type, or actor…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter audit log"
            />
          </div>

          {visibleLogs && visibleLogs.length === 0 ? (
            <EmptyState title="No matches" description={`Nothing matches "${query}".`} />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Actor</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Entity</TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleLogs!.map((log) => {
                  const isExpanded = expandedId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <TableRow
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpandedId(isExpanded ? null : log.id);
                          }
                        }}
                      >
                        <TableCell className="whitespace-nowrap text-slate-500">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate">
                          <span className="inline-flex items-center gap-1.5">
                            {log.actorType === "ai_agent" ? (
                              <IconSparkle className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                            ) : (
                              <IconUser className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            )}
                            {actorLabel(log)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge tone={ACTOR_TONE[log.actorType]}>{log.action}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-500">
                          {log.entityType} <span className="text-slate-400">·</span>{" "}
                          <span className="font-mono text-xs">{log.entityId.slice(0, 8)}</span>
                        </TableCell>
                        <TableCell className="text-right text-xs text-slate-400">
                          {isExpanded ? "Hide" : "Details"}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={5} className="bg-slate-50">
                            <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  Before
                                </p>
                                <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
                                  {log.before ? JSON.stringify(log.before, null, 2) : "—"}
                                </pre>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  After
                                </p>
                                <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
                                  {log.after ? JSON.stringify(log.after, null, 2) : "—"}
                                </pre>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}

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

function AuditLogSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}
