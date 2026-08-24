"use client";

// Governed-Action Approval Queue — every action awaiting a checker
// decision (CLAUDE.md: maker-checker at the individual level). Decisions
// are always sent to the backend and never pre-validated client-side;
// the backend is the single source of truth for who's eligible to check
// which action (see decide() below).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { formatDate, humanizePermissionKey } from "../../lib/format";
import type { GovernedAction } from "../../lib/types";
import {
  Alert,
  Button,
  EmptyState,
  IconCheckCircle,
  IconClipboardCheck,
  IconClock,
  IconSparkle,
  IconUser,
  IconXCircle,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

type RowState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; approved: boolean }
  | { status: "error"; message: string };

const IDLE: RowState = { status: "idle" };

export default function GovernedActionsPage() {
  const [actions, setActions] = useState<GovernedAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  const load = useCallback(() => {
    setError(null);
    apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed")
      .then(setActions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Derived from the already-fetched queue, not a separate fetch: how
  // many of today's pending decisions originate from an AI agent maker
  // vs. a human officer maker (CLAUDE.md: agents may only ever be a
  // maker, never a checker — this is genuinely useful context for a
  // checker deciding how much scrutiny a row needs).
  const counts = useMemo(() => {
    if (!actions) return null;
    return actions.reduce(
      (acc, a) => {
        if (a.makerType === "ai_agent") acc.agent += 1;
        else acc.human += 1;
        return acc;
      },
      { agent: 0, human: 0 },
    );
  }, [actions]);

  async function decide(actionId: string, approve: boolean) {
    setRowStates((prev) => ({ ...prev, [actionId]: { status: "pending" } }));
    try {
      await apiFetchJson(`/governed-actions/${actionId}/decide`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      setRowStates((prev) => ({ ...prev, [actionId]: { status: "success", approved: approve } }));
      // Give the officer a moment to see the confirmation before the row
      // leaves the queue.
      setTimeout(() => {
        setActions((prev) => (prev ? prev.filter((a) => a.id !== actionId) : prev));
        setRowStates((prev) => {
          const next = { ...prev };
          delete next[actionId];
          return next;
        });
      }, 1200);
    } catch (err) {
      setRowStates((prev) => ({
        ...prev,
        [actionId]: {
          status: "error",
          message: err instanceof Error ? err.message : "Something went wrong.",
        },
      }));
    }
  }

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <IconClipboardCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Approval Queue</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Governed actions currently awaiting a decision. Approving or rejecting is final and recorded to the
            audit trail.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load the approval queue" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && actions === null && <QueueSkeleton />}

      {!error && actions !== null && actions.length === 0 && (
        <EmptyState
          title="Nothing awaiting approval"
          description="Proposed actions from officers and agents will appear here once they need a checker decision."
        />
      )}

      {!error && actions !== null && actions.length > 0 && counts && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Awaiting decision"
              value={actions.length}
              tone="primary"
              icon={<IconClock className="h-[18px] w-[18px]" />}
            />
            <StatCard
              label="Proposed by AI agents"
              value={counts.agent}
              tone="warning"
              icon={<IconSparkle className="h-[18px] w-[18px]" />}
            />
            <StatCard
              label="Proposed by officers"
              value={counts.human}
              tone="neutral"
              icon={<IconUser className="h-[18px] w-[18px]" />}
            />
          </div>

          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Permission</TableHeaderCell>
                <TableHeaderCell>Waqf</TableHeaderCell>
                <TableHeaderCell>Proposed by</TableHeaderCell>
                <TableHeaderCell className="whitespace-nowrap">Proposed</TableHeaderCell>
                <TableHeaderCell className="whitespace-nowrap text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {actions.map((action) => {
                const rowState = rowStates[action.id] ?? IDLE;
                const isPending = rowState.status === "pending";
                const isSuccess = rowState.status === "success";
                return (
                  <Fragment key={action.id}>
                    <TableRow>
                      <TableCell className="max-w-xs">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="break-words font-medium text-slate-900">
                            {humanizePermissionKey(action.permission.key)}
                          </span>
                          {action.permission.category && (
                            <span className="inline-block shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                              {action.permission.category}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="max-w-[10rem] truncate"
                        title={action.waqf?.name ?? action.proposedFoundation?.name}
                      >
                        {action.waqf?.name ??
                          (action.proposedFoundation ? (
                            <span className="text-slate-500">
                              <span className="text-slate-400">Foundation:</span> {action.proposedFoundation.name}
                            </span>
                          ) : (
                            <span className="italic text-slate-400">Not yet created</span>
                          ))}
                      </TableCell>
                      <TableCell className="max-w-[9rem] truncate">
                        <span className="inline-flex items-center gap-1.5">
                          {action.makerType === "ai_agent" ? (
                            <IconSparkle className="h-3.5 w-3.5 shrink-0 text-accent-500" />
                          ) : (
                            <IconUser className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          )}
                          {action.makerType === "ai_agent" ? "AI Agent" : (action.makerUser?.fullName ?? "—")}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-500">
                        {formatDate(action.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {isSuccess ? (
                          <span
                            className={`inline-flex items-center justify-end gap-1.5 text-sm font-medium ${
                              rowState.approved ? "text-primary-700" : "text-red-600"
                            }`}
                          >
                            {rowState.approved ? (
                              <IconCheckCircle className="h-4 w-4" />
                            ) : (
                              <IconXCircle className="h-4 w-4" />
                            )}
                            {rowState.approved ? "Approved" : "Rejected"}
                          </span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="primary"
                              className="px-3 py-1.5 text-xs"
                              disabled={isPending}
                              onClick={() => decide(action.id, true)}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="danger"
                              className="px-3 py-1.5 text-xs"
                              disabled={isPending}
                              onClick={() => decide(action.id, false)}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {rowState.status === "error" && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="bg-red-50 py-2.5 text-xs text-red-700">
                          Couldn&apos;t record decision for &ldquo;{humanizePermissionKey(action.permission.key)}
                          &rdquo;: {rowState.message}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3.5 rounded-lg border border-slate-200 bg-white px-4 py-3.5">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="divide-y divide-slate-100">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-8 px-5 py-3.5">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
