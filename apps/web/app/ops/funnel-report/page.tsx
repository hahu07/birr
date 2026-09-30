"use client";

// Simple staff-side view over FunnelEvent — see FunnelEventsService's
// own report() comment (apps/backend/src/modules/funnel-events) for
// what these counts do and don't guarantee: every landed event counts,
// nothing here is deduplicated by visitor/session. No dashboard beyond
// this was the deliberate v1 call (CLAUDE.md's Marketing Strategy
// work); this is deliberately a plain table, not a chart.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import type { FunnelReport, FunnelStepCount } from "../../../lib/ops-types";
import {
  Alert,
  Card,
  IconClipboardCheck,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const RANGE_OPTIONS = [
  { label: "All time", days: null },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

function percent(count: number, of: number): string {
  return of > 0 ? `${Math.round((count / of) * 100)}%` : "—";
}

function FunnelTable({ title, steps }: { title: string; steps: FunnelStepCount[] }) {
  const first = steps[0]?.count ?? 0;
  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Step</TableHeaderCell>
            <TableHeaderCell>Count</TableHeaderCell>
            <TableHeaderCell>% of step 1</TableHeaderCell>
            <TableHeaderCell>% of previous step</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {steps.map((s, i) => (
            <TableRow key={s.step}>
              <TableCell className="font-medium text-slate-900">{humanize(s.step)}</TableCell>
              <TableCell>{s.count.toLocaleString()}</TableCell>
              <TableCell>{percent(s.count, first)}</TableCell>
              <TableCell>{i === 0 ? "—" : percent(s.count, steps[i - 1].count)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function FunnelReportPage() {
  const [rangeIndex, setRangeIndex] = useState("2"); // default "Last 30 days"
  const [report, setReport] = useState<FunnelReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    const days = RANGE_OPTIONS[Number(rangeIndex)].days;
    const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
    apiFetchJson<FunnelReport>(`/funnel-events/report${since ? `?since=${encodeURIComponent(since)}` : ""}`)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [rangeIndex]);

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Funnel Report</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Step-by-step counts for Founder establishment and Vault giving.
            </p>
          </div>
        </div>
        <Select value={rangeIndex} onChange={(e) => setRangeIndex(e.target.value)} className="shrink-0">
          {RANGE_OPTIONS.map((opt, i) => (
            <option key={opt.label} value={i}>
              {opt.label}
            </option>
          ))}
        </Select>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load the funnel report" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && report === null && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      )}

      {!error && report !== null && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FunnelTable title="Founder Establishment" steps={report.founder} />
          <FunnelTable title="Vault Giving" steps={report.vault} />
        </div>
      )}
    </div>
  );
}
