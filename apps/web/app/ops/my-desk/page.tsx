"use client";

// Officer Caseload — every waqf case assignment for the signed-in Birr
// staff member specifically (see CLAUDE.md: the caseload concept,
// waqf_case_assignments). Split out from the platform-wide Overview
// (app/ops/page.tsx) at the user's request — this page is personal, not
// the same for every staff member, so it only even shows up in the
// sidebar nav for staff who actually have a caseload (see app-shell.tsx's
// hasCaseload prop / requiresCaseload nav filter) — a staff member with
// none never sees an empty "My Desk" link at all.
import { useEffect, useMemo, useState } from "react";
import { useStaffSession } from "../../../lib/staff-session";
import { apiFetchJson } from "../../../lib/api";
import { humanize, formatDate } from "../../../lib/format";
import type { WaqfCaseAssignment } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  EmptyState,
  IconArchive,
  IconCheckCircle,
  IconInbox,
  IconRepeat,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const STATUS_TONE: Record<WaqfCaseAssignment["status"], "success" | "warning" | "neutral"> = {
  active: "success",
  reassigned: "warning",
  closed: "neutral",
};

type StatusCounts = Record<WaqfCaseAssignment["status"], number>;

export default function MyDeskPage() {
  const { staff } = useStaffSession();
  const [cases, setCases] = useState<WaqfCaseAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    setError(null);
    apiFetchJson<WaqfCaseAssignment[]>(`/waqf-case-assignments?birrStaffId=${staff.id}`)
      .then((data) => {
        if (!cancelled) setCases(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [staff]);

  // Derived purely from the already-fetched caseload — not a separate
  // fetch — so this can't drift from what the table below shows.
  const counts = useMemo<StatusCounts | null>(() => {
    if (!cases) return null;
    return cases.reduce<StatusCounts>(
      (acc, c) => {
        acc[c.status] += 1;
        return acc;
      },
      { active: 0, reassigned: 0, closed: 0 },
    );
  }, [cases]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconInbox className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Desk</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Every waqf case assignment currently on your desk, across all governance functions you serve.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load your caseload" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && cases === null && <CaseloadSkeleton />}

      {!error && cases !== null && cases.length === 0 && (
        <EmptyState
          title="No cases assigned yet"
          description="Waqf case assignments you're staffed on will appear here as soon as they're set up."
        />
      )}

      {!error && cases !== null && cases.length > 0 && counts && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Active"
              value={counts.active}
              tone="success"
              icon={<IconCheckCircle className="h-[18px] w-[18px]" />}
            />
            <StatCard
              label="Reassigned"
              value={counts.reassigned}
              tone="warning"
              icon={<IconRepeat className="h-[18px] w-[18px]" />}
            />
            <StatCard
              label="Closed"
              value={counts.closed}
              tone="neutral"
              icon={<IconArchive className="h-[18px] w-[18px]" />}
            />
          </div>

          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Waqf</TableHeaderCell>
                <TableHeaderCell>Assignment role</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Assigned</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <span className="font-medium text-primary-700">{c.waqf.name}</span>
                  </TableCell>
                  <TableCell>{humanize(c.assignmentRole)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[c.status]}>{humanize(c.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-slate-500">{formatDate(c.assignedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

function CaseloadSkeleton() {
  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3.5 rounded-lg border border-slate-200 bg-white px-4 py-3.5">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="divide-y divide-slate-100">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-8 px-5 py-3.5">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
