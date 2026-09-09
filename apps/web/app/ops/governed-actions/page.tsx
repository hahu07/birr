"use client";

// Governed-Action Approval Queue — every action awaiting a checker
// decision (CLAUDE.md: maker-checker at the individual level). Decisions
// are always sent to the backend and never pre-validated client-side;
// the backend is the single source of truth for who's eligible to check
// which action (see decide() below).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { agentNickname, formatDate, humanize, humanizePermissionKey } from "../../../lib/format";
import { markNotificationsReadForEntity } from "../../../lib/notifications";
import { useStaffSession } from "../../../lib/staff-session";
import type { GovernedAction } from "../../../lib/ops-types";
import {
  Alert,
  Button,
  EmptyState,
  IconCheckCircle,
  IconChevronDown,
  IconClipboardCheck,
  IconClock,
  IconSparkle,
  IconUser,
  IconXCircle,
  Input,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

// Renders a governed action's payload as plain label/value pairs — not a
// narrated summary (that would need looking up the referenced
// asset/beneficiary/investment/distribution by id, out of scope here),
// but a real improvement over what shipped before this: nothing. An
// officer can at least see exactly what's being proposed, and cross
// -reference an id elsewhere, instead of approving or rejecting blind.
//
// `currentState` is fetched lazily (GET /governed-actions/:id, only on
// row-expand — see the caller) and is undefined while that fetch is in
// flight or hasn't started, null once fetched for a handler with no
// describeCurrentState (e.g. counterparty.onboard). Either way this
// degrades to the plain payload-only rendering it replaced — a field
// only gets the current → proposed treatment once a current value for
// that exact key is actually known.
function PayloadDetails({
  payload,
  currentState,
}: {
  payload: unknown;
  currentState?: Record<string, unknown> | null;
}) {
  if (payload === null || typeof payload !== "object") {
    return <span className="text-slate-500">{String(payload)}</span>;
  }
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="text-slate-500">No additional details.</span>;
  }
  const stringify = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([key, value]) => {
        const hasCurrent = currentState != null && Object.prototype.hasOwnProperty.call(currentState, key);
        const proposedText = stringify(value);
        const currentText = hasCurrent ? stringify(currentState![key]) : null;
        const differs = hasCurrent && currentText !== proposedText;
        return (
          <Fragment key={key}>
            <dt className="font-medium text-slate-500">{humanize(key.replace(/([a-z])([A-Z])/g, "$1_$2"))}</dt>
            <dd className="break-all font-mono text-slate-700">
              {differs ? (
                <>
                  <span className="text-slate-500 line-through">{currentText}</span>
                  <span className="mx-1 text-slate-500">→</span>
                  <span className="font-semibold text-primary-700">{proposedText}</span>
                </>
              ) : (
                proposedText
              )}
            </dd>
          </Fragment>
        );
      })}
    </dl>
  );
}

type RowState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; approved: boolean }
  | { status: "error"; message: string };

const IDLE: RowState = { status: "idle" };

export default function GovernedActionsPage() {
  const { staff } = useStaffSession();
  const [actions, setActions] = useState<GovernedAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Keyed by action id; absent while the GET /governed-actions/:id fetch
  // for that row hasn't started or is still in flight — see
  // PayloadDetails's own comment on why that degrades gracefully rather
  // than needing a loading state of its own.
  const [currentStates, setCurrentStates] = useState<Record<string, Record<string, unknown> | null>>({});
  // Ids of actions whose payload has been expanded at least once this
  // session — a checker must actually look at what they're deciding
  // before Approve/Reject become clickable (see the render below).
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setError(null);
    apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed")
      .then(setActions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment): this queue IS the content
  // governed_action.proposed's linkUrl points to — an officer viewing it
  // here should mark that notification read the same way opening a
  // message thread already does for message.received, not only via the
  // bell dropdown.
  useEffect(() => {
    actions?.forEach((action) => markNotificationsReadForEntity("GovernedAction", action.id));
  }, [actions]);

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

  // Search narrows the table only — the stat cards above stay counting
  // the true full queue regardless of what's currently filtered, since
  // "how many are actually awaiting decision" is operationally
  // important context a search shouldn't quietly hide.
  const query = search.trim().toLowerCase();
  const visibleActions =
    actions?.filter((a) => {
      if (!query) return true;
      const makerName =
        a.makerType === "ai_agent" ? (a.makerAgent ? agentNickname(a.makerAgent.name) : "") : (a.makerUser?.fullName ?? "");
      return (
        humanizePermissionKey(a.permission.key).toLowerCase().includes(query) ||
        (a.waqf?.name ?? a.proposedFoundation?.name ?? "").toLowerCase().includes(query) ||
        makerName.toLowerCase().includes(query)
      );
    }) ?? [];

  async function decide(actionId: string, approve: boolean, permissionLabel: string) {
    // Native confirm, deliberately not silent — approving or rejecting is
    // final and audit-logged the moment the request lands (see the page
    // header copy below), so a single misclick should have one more
    // chance to be caught here.
    if (!window.confirm(`${approve ? "Approve" : "Reject"} "${permissionLabel}"? This is final and will be recorded to the audit trail.`)) {
      return;
    }
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
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconClipboardCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Approvals</h1>
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
              tone="violet"
              icon={<IconSparkle className="h-[18px] w-[18px]" />}
            />
            <StatCard
              label="Proposed by officers"
              value={counts.human}
              tone="neutral"
              icon={<IconUser className="h-[18px] w-[18px]" />}
            />
          </div>

          <Input
            placeholder="Search by permission, waqf, or proposer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 max-w-xs"
          />

          {visibleActions.length === 0 ? (
            <p className="text-sm text-slate-500">No pending actions match "{search.trim()}".</p>
          ) : (
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
              {visibleActions.map((action) => {
                const rowState = rowStates[action.id] ?? IDLE;
                const isPending = rowState.status === "pending";
                const isSuccess = rowState.status === "success";
                const isExpanded = expandedId === action.id;
                const hasBeenViewed = viewedIds.has(action.id);
                // A human maker can never also be this row's checker — the
                // DB constraint is the real enforcement, but making that
                // impossible to attempt in the first place (rather than
                // surfacing as an error after a click) is the point of
                // this guard. Irrelevant for an ai_agent maker: an agent
                // can never be a checker at all, by anyone.
                const isOwnProposal =
                  action.makerType === "human" && Boolean(staff) && action.makerUserId === staff?.userId;
                return (
                  <Fragment key={action.id}>
                    <TableRow>
                      <TableCell className="max-w-xs">
                        <button
                          type="button"
                          onClick={() => {
                            const nowExpanded = !isExpanded;
                            setExpandedId(nowExpanded ? action.id : null);
                            setViewedIds((prev) => (prev.has(action.id) ? prev : new Set(prev).add(action.id)));
                            if (nowExpanded && !(action.id in currentStates)) {
                              apiFetchJson<GovernedAction>(`/governed-actions/${action.id}`)
                                .then((full) => {
                                  setCurrentStates((prev) => ({ ...prev, [action.id]: full.currentState ?? null }));
                                })
                                .catch(() => {
                                  // Diff is a nice-to-have on top of the payload, which
                                  // already rendered — a failed fetch just means the
                                  // row falls back to payload-only, not a page error.
                                });
                            }
                          }}
                          className="flex w-full flex-col items-start gap-0.5 text-left"
                          aria-expanded={isExpanded}
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <IconChevronDown
                              className={`h-3.5 w-3.5 shrink-0 self-center text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            />
                            <span className="break-words font-medium text-slate-900">
                              {humanizePermissionKey(action.permission.key)}
                            </span>
                            {action.permission.category && (
                              <span className="inline-block shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                                {action.permission.category}
                              </span>
                            )}
                          </span>
                          {/* The one thing that actually tells two same-
                              permission, same-waqf, same-day proposals
                              apart at a glance — without this, an officer
                              can only distinguish them by expanding each
                              and comparing raw entity ids. */}
                          {action.summary && (
                            <span className="break-words pl-5 text-xs text-slate-500">{action.summary}</span>
                          )}
                        </button>
                      </TableCell>
                      <TableCell
                        className="max-w-[10rem] truncate"
                        title={action.waqf?.name ?? action.proposedFoundation?.name}
                      >
                        {action.waqf?.name ??
                          (action.proposedFoundation ? (
                            <span className="text-slate-500">
                              <span className="text-slate-500">Foundation:</span> {action.proposedFoundation.name}
                            </span>
                          ) : (
                            <span className="italic text-slate-500">Not yet created</span>
                          ))}
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate">
                        <span className="inline-flex items-center gap-1.5" title={
                          action.makerType === "ai_agent"
                            ? (action.makerAgent ? agentNickname(action.makerAgent.name) : undefined)
                            : action.makerUser?.email
                        }>
                          {action.makerType === "ai_agent" ? (
                            <IconSparkle className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                          ) : (
                            <IconUser className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          )}
                          {action.makerType === "ai_agent"
                            ? (action.makerAgent ? agentNickname(action.makerAgent.name) : "Unregistered agent")
                            : (action.makerUser?.fullName ?? "—")}
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
                        ) : isOwnProposal ? (
                          <span className="text-xs italic text-slate-500" title="Maker-checker: you proposed this, so someone else must decide it.">
                            You proposed this
                          </span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="primary"
                                className="px-3 py-1.5 text-xs"
                                disabled={isPending || !hasBeenViewed}
                                title={!hasBeenViewed ? "Expand this row to review the payload before deciding." : undefined}
                                onClick={() => decide(action.id, true, humanizePermissionKey(action.permission.key))}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="danger"
                                className="px-3 py-1.5 text-xs"
                                disabled={isPending || !hasBeenViewed}
                                title={!hasBeenViewed ? "Expand this row to review the payload before deciding." : undefined}
                                onClick={() => decide(action.id, false, humanizePermissionKey(action.permission.key))}
                              >
                                Reject
                              </Button>
                            </div>
                            {!hasBeenViewed && (
                              <span className="text-[11px] italic text-slate-500">Expand to review before deciding</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="bg-slate-50 py-3">
                          <PayloadDetails payload={action.payload} currentState={currentStates[action.id]} />
                        </TableCell>
                      </TableRow>
                    )}
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
          )}
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
