"use client";

// System health (2026-11-16): every scheduled job — monthly charges, the
// daily Paystack reconciliation, the daily checks, the database backup and
// the monthly restore drill — with its last run, when it should next have
// succeeded by, and recent failures. A failure also reaches platform
// admins' bell as it happens (common/jobs/job-monitor.ts). What has to be
// set up outside the app is in docs/monitoring-and-recovery.md.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, Badge, Card, IconShieldCheck, Skeleton } from "@birr/ui";

interface JobHealth {
  job: string;
  label: string;
  everyMs: number;
  external: boolean;
  public: boolean;
  lastRun: { status: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
  lastSuccessAt: string | null;
  lastFailure: { startedAt: string; error: string | null } | null;
  dueBy: string | null;
  overdue: boolean;
  failing: boolean;
}

interface SystemHealth {
  checkedAt: string;
  jobs: JobHealth[];
  recentFailures: { id: string; job: string; startedAt: string; error: string | null }[];
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never";
const every = (ms: number) => (ms >= 30 * 86_400_000 ? "monthly" : ms >= 86_400_000 ? "daily" : "hourly");

export default function SystemHealthPage() {
  const [data, setData] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<SystemHealth>("/system/health")
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  const problems = data?.jobs.filter((j) => j.overdue || j.failing) ?? [];

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">System health</h1>
          <p className="mt-0.5 text-sm text-slate-500">Scheduled jobs, backups and the restore drill. A failure also reaches your bell as it happens.</p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load system health" className="mb-6">
          {error}
        </Alert>
      )}
      {!error && !data && <Skeleton className="h-64 w-full" />}

      {data && (
        <>
          {problems.length === 0 ? (
            <Alert tone="success" title="Everything is running" className="mb-6">
              Every scheduled job succeeded within its expected time.
            </Alert>
          ) : (
            <Alert tone="danger" title={`${problems.length} ${problems.length === 1 ? "job needs" : "jobs need"} attention`} className="mb-6">
              {problems.map((j) => j.label).join("; ")}.
            </Alert>
          )}

          <ul className="mb-8 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {data.jobs.map((j) => (
              <li key={j.job} className="grid gap-2 px-5 py-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{j.label}</p>
                  <p className="text-xs text-slate-500">
                    Runs {every(j.everyMs)}
                    {j.external ? " · reports in from outside the app" : ""}
                    {!j.public ? " · not part of the uptime check" : ""}
                  </p>
                  {j.failing && j.lastRun?.error && <p className="mt-1 text-xs text-red-700">{j.lastRun.error}</p>}
                </div>
                <div className="text-sm text-slate-600">
                  <span className="block text-xs text-slate-500">Last succeeded</span>
                  {when(j.lastSuccessAt)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm md:justify-end">
                  {j.failing ? <Badge tone="danger">Last run failed</Badge> : null}
                  {j.overdue ? <Badge tone="warning">{j.lastSuccessAt ? "Overdue" : "Never succeeded"}</Badge> : null}
                  {!j.failing && !j.overdue && <Badge tone="success">On time</Badge>}
                  {j.dueBy && <span className="text-xs text-slate-500">due by {when(j.dueBy)}</span>}
                </div>
              </li>
            ))}
          </ul>

          <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent failures</h2>
          {data.recentFailures.length === 0 ? (
            <p className="mb-8 rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-500">None recorded.</p>
          ) : (
            <ul className="mb-8 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {data.recentFailures.map((f) => (
                <li key={f.id} className="px-5 py-3 text-sm">
                  <span className="font-medium text-slate-900">{data.jobs.find((j) => j.job === f.job)?.label ?? f.job}</span>
                  <span className="text-slate-500"> · {when(f.startedAt)}</span>
                  {f.error && <span className="mt-0.5 block font-mono text-xs text-red-700">{f.error}</span>}
                </li>
              ))}
            </ul>
          )}

          <Card className="text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Outside the app</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>An uptime monitor on <span className="font-mono">/health</span> (the server is up) and <span className="font-mono">/health/jobs</span> (every job is on time).</li>
              <li>
                <span className="font-mono">SENTRY_DSN</span> set, so errors and failed jobs are reported with their detail.
              </li>
              <li>The daily backup cron and the monthly restore drill. See docs/monitoring-and-recovery.md.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
