"use client";

// Audit Log viewer — the append-only audit_logs table (CLAUDE.md's
// cross-cutting non-negotiable: every write on a governed entity, plus
// every agent-initiated action, lands here). Read-only by design; there
// is no UPDATE/DELETE route because there's no UPDATE/DELETE grant on
// this table at the DB role level either.
import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { formatDate } from "../../lib/format";
import type { AuditLog } from "../../lib/types";
import {
  Alert,
  Badge,
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

const ACTOR_TONE: Record<AuditLog["actorType"], "success" | "warning" | "neutral"> = {
  birr_staff: "success",
  founder_user: "neutral",
  ai_agent: "warning",
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
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<AuditLog[]>("/audit-logs")
      .then(setLogs)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

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
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <IconFileText className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Audit Log</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            The most recent 100 entries, newest first — append-only, never edited or deleted.
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
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      >
                        <TableCell className="whitespace-nowrap text-slate-500">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate">
                          <span className="inline-flex items-center gap-1.5">
                            {log.actorType === "ai_agent" ? (
                              <IconSparkle className="h-3.5 w-3.5 shrink-0 text-accent-500" />
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
