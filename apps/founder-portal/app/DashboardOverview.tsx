"use client";

// Waqf Overview — a real summary page, not where the portfolio itself
// lives. Shows the headline stat and the founder's own profile; the
// actual Foundation/Waqf Fund breakdown lives on /portfolio (see
// app/portfolio/page.tsx) and each fund's full detail on
// /portfolio/[id]. Establishment (Foundation, Waqf Fund) is donor
// self-service, immediate, no approval gate; ongoing governance of an
// existing Waqf Fund stays exclusively Birr-staff-mediated elsewhere.
// Rendered by page.tsx only once a session exists — see MarketingHome
// for the signed-out counterpart at the same route ("/").
import Link from "next/link";
import { useEffect, useState } from "react";
import { Founder, useFounderSession } from "../lib/founder-session";
import { apiFetchJson } from "../lib/api";
import { describeFounderKind, humanize } from "../lib/format";
import { countByStatus, groupByFoundation, STATUS_ICON, STATUS_STAT_TONE } from "../lib/portfolio";
import type { Waqf } from "../lib/types";
import { Alert, Button, Card, DetailGrid, EmptyState, IconBriefcase, Skeleton, StatCard } from "@birr/ui";

export default function DashboardOverview() {
  // AppShell only ever renders this page once `founder` has resolved to a
  // real record (see app/app-shell.tsx), so this is never null in practice
  // — the check below is just for TypeScript.
  const { founder } = useFounderSession();
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!founder) return;
    let cancelled = false;
    setError(null);
    apiFetchJson<Waqf[]>("/waqfs")
      .then((data) => {
        if (!cancelled) setWaqfs(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [founder]);

  if (!founder) return null;

  const foundationCount = waqfs ? groupByFoundation(waqfs).length : null;

  return (
    <div>
      <Hero founder={founder} waqfs={waqfs} error={error} foundationCount={foundationCount} />

      <Card className="mb-8 border-slate-100 bg-slate-50/60 p-5 shadow-none">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">About {founder.name}</p>
        <DetailGrid
          columns={2}
          items={[
            { label: "Type", value: describeFounderKind(founder) },
            { label: "Home jurisdiction", value: founder.homeJurisdiction ?? "Not on file" },
          ]}
        />
      </Card>

      {error && (
        <Alert tone="danger" title="Couldn't load your waqf">
          {error}
        </Alert>
      )}

      {!error && waqfs === null && <SummarySkeleton />}

      {!error && waqfs !== null && waqfs.length === 0 && (
        <EmptyState
          title="No waqf yet"
          description="Establish a Foundation to get started — you can add Waqf Funds under it right away."
          action={
            <Link href="/foundations/new">
              <Button variant="primary">Establish a Foundation</Button>
            </Link>
          }
        />
      )}

      {!error && waqfs !== null && waqfs.length > 0 && (
        <Card className="p-0">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <p className="text-sm font-medium text-slate-700">
              {foundationCount} {foundationCount === 1 ? "foundation" : "foundations"}
            </p>
            <Link href="/portfolio" className="text-sm font-medium text-primary-700 hover:text-primary-800">
              View full portfolio →
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {groupByFoundation(waqfs).map(({ foundation, waqfs: foundationWaqfs }) => (
              <li key={foundation.id}>
                <Link
                  href="/portfolio"
                  className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-primary-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{foundation.name}</span>
                    <span className="block text-xs text-slate-500">
                      {foundationWaqfs.length} waqf {foundationWaqfs.length === 1 ? "fund" : "funds"}
                    </span>
                  </span>
                  <IconBriefcase className="h-4 w-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * The page's focal point — a large, honest number before any supporting
 * detail (Mercury-style account summary), derived entirely from the
 * `GET /waqfs` response already being fetched. Deliberately does NOT
 * render "0" as the big numeral for a founder with no waqf yet: a bare
 * "0" in this type size reads as a failure/error state, not as the
 * (entirely normal, pre-establishment) status it actually is — so the
 * zero case gets a welcoming sentence instead of a numeral.
 */
function Hero({
  founder,
  waqfs,
  error,
  foundationCount,
}: {
  founder: Founder;
  waqfs: Waqf[] | null;
  error: string | null;
  foundationCount: number | null;
}) {
  const eyebrow = <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Waqf Overview</p>;

  if (error) {
    return (
      <header className="mb-10">
        {eyebrow}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Welcome, {founder.name}</h1>
      </header>
    );
  }

  if (waqfs === null) {
    return (
      <header className="mb-10">
        {eyebrow}
        <div className="mt-3">
          <Skeleton className="h-12 w-20" />
        </div>
        <Skeleton className="mt-3 h-4 w-72" />
      </header>
    );
  }

  if (waqfs.length === 0) {
    return (
      <header className="mb-10">
        {eyebrow}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Welcome, {founder.name}</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-500">
          Birr serves as Mutawalli (trustee) on your behalf. Once your waqf is established, it will appear here.
        </p>
      </header>
    );
  }

  const counts = countByStatus(waqfs);
  const statuses = Object.keys(counts) as Waqf["status"][];

  return (
    <header className="mb-10">
      {eyebrow}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-6xl font-semibold tracking-tight text-primary-900">{waqfs.length}</span>
        <span className="text-lg font-medium text-slate-600">
          {`${waqfs.length === 1 ? "waqf" : "waqfs"} under Birr’s trusteeship`}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Birr serves as Mutawalli (trustee) on behalf of {founder.name}, across {foundationCount}{" "}
        {foundationCount === 1 ? "foundation" : "foundations"}.
      </p>

      {statuses.length > 1 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statuses.map((status) => {
            const Icon = STATUS_ICON[status];
            return (
              <StatCard
                key={status}
                label={humanize(status)}
                value={counts[status]}
                tone={STATUS_STAT_TONE[status]}
                icon={<Icon className="h-[18px] w-[18px]" />}
              />
            );
          })}
        </div>
      )}
    </header>
  );
}

function SummarySkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
