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
import { useEffect, useMemo, useState } from "react";
import { Founder, useFounderSession } from "../../lib/founder-session";
import { apiFetchJson } from "../../lib/api";
import { describeFounderKind, formatAmount, humanize, WAQF_STATUS_CHART_COLOR } from "../../lib/format";
import { countByStatus, groupByFoundation, STATUS_ICON, STATUS_STAT_TONE } from "../../lib/portfolio";
import type { Waqf } from "../../lib/types";
import {
  Alert,
  Button,
  Card,
  DetailGrid,
  DonutChart,
  EmptyState,
  IconBriefcase,
  IconCheckCircle,
  IconClipboardCheck,
  Skeleton,
  StatCard,
} from "@birr/ui";
import type { DonutChartSegment } from "@birr/ui";

interface CurrencyTotal {
  currency: string;
  totalAmount: string;
}

// Distributed money is kept split by waqf type, never blended into one
// figure — an Investment-type waqf's distributions draw on
// WaqfCause.proceedsAllocatedAmount (investment returns) ALONE, per the
// 2026-09-04 decision (corpus is no longer itself distributable for
// Investment funds), while every other type only ever spends corpus.
// Folding both into one "Distributed" number would silently mix money
// with two different fiduciary characters. See DistributionsService
// .founderSummary's own comment.
interface DistributedTotal extends CurrencyTotal {
  waqfType: Waqf["type"];
}

const WAQF_TYPE_LABEL: Record<Waqf["type"], string> = {
  investment: "Distributed via Investment funds",
  asset: "Distributed via Asset funds",
  project: "Distributed via Project funds",
};

export default function DashboardOverview() {
  // AppShell only ever renders this page once `founder` has resolved to a
  // real record (see app/app-shell.tsx), so this is never null in practice
  // — the check below is just for TypeScript.
  const { founder } = useFounderSession();
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [raised, setRaised] = useState<CurrencyTotal[] | null>(null);
  const [distributed, setDistributed] = useState<DistributedTotal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!founder) return;
    let cancelled = false;
    setError(null);
    Promise.all([
      apiFetchJson<Waqf[]>("/waqfs"),
      apiFetchJson<CurrencyTotal[]>("/contributions/founder-summary"),
      apiFetchJson<DistributedTotal[]>("/distributions/founder-summary"),
    ])
      .then(([w, r, d]) => {
        if (cancelled) return;
        setWaqfs(w);
        setRaised(r);
        setDistributed(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [founder]);

  // Keyed by (type, currency), not currency alone — same reasoning as
  // the Distributed split above (see DistributedTotal's own comment):
  // an Investment waqf's corpus and a Project waqf's corpus carry
  // different fiduciary character, so blending them hides that.
  const corpusByTypeAndCurrency = useMemo(() => {
    if (!waqfs) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const w of waqfs) {
      if (!w.corpusAmount || !w.corpusCurrency) continue;
      const key = `${w.type}:${w.corpusCurrency}`;
      map.set(key, (map.get(key) ?? 0) + Number(w.corpusAmount));
    }
    return map;
  }, [waqfs]);

  const statusSegments: DonutChartSegment[] = useMemo(() => {
    if (!waqfs) return [];
    const counts = countByStatus(waqfs);
    return (Object.keys(counts) as Waqf["status"][]).map((status) => ({
      label: humanize(status),
      value: counts[status] ?? 0,
      color: WAQF_STATUS_CHART_COLOR[status],
    }));
  }, [waqfs]);

  if (!founder) return null;

  const foundationCount = waqfs ? groupByFoundation(waqfs).length : null;

  return (
    <div>
      <Hero founder={founder} waqfs={waqfs} error={error} foundationCount={foundationCount} />

      {!error && waqfs !== null && waqfs.length > 0 && (
        <>
          {/* auto-fit/minmax, not a fixed column count — this grid's tile
              count varies (one per waqf type/currency combination, could
              be 1 or several), and a fixed grid-cols-2/4 split forced
              each tile into a column far narrower than its content (a
              13-character amount like "1,500,000.00" in 20px bold text)
              whenever there were fewer tiles than columns. Found on an
              800px-wide viewport with just 2 tiles, 2026-09-29 codebase
              walkthrough — each tile was squeezed into 1 of 4 equal
              columns and its value clipped/wrapped character-by-character.
              220px floor (vs. the status-count grid below's 140px) —
              these values are formatted currency amounts, a single
              unbroken token roughly twice as wide as a plain integer
              count, so they need more room before wrapping at all. */}
          <div className="mb-8 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
            {[...corpusByTypeAndCurrency.entries()].map(([key, amount]) => {
              const [type, currency] = key.split(":") as [Waqf["type"], string];
              return (
                <StatCard
                  key={`corpus-${key}`}
                  label={`Declared corpus — ${humanize(type)} (${currency})`}
                  value={formatAmount(amount)}
                  tone="neutral"
                  icon={<IconBriefcase className="h-[18px] w-[18px]" />}
                />
              );
            })}
            {(raised ?? []).map((r) => (
              <StatCard
                key={`raised-${r.currency}`}
                label={`Raised (${r.currency})`}
                value={formatAmount(r.totalAmount)}
                tone="success"
                icon={<IconCheckCircle className="h-[18px] w-[18px]" />}
              />
            ))}
            {(distributed ?? []).map((d) => (
              <StatCard
                key={`distributed-${d.waqfType}-${d.currency}`}
                label={`${WAQF_TYPE_LABEL[d.waqfType]} (${d.currency})`}
                value={formatAmount(d.totalAmount)}
                tone="primary"
                icon={<IconClipboardCheck className="h-[18px] w-[18px]" />}
              />
            ))}
          </div>

          {statusSegments.length > 1 && (
            <Card className="mb-8">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Waqf funds by status</h2>
              <DonutChart segments={statusSegments} centerLabel="funds" />
            </Card>
          )}
        </>
      )}

      <Card tone="primary" className="mb-8 p-5 shadow-none">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">About {founder.name}</p>
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
        <Card tone="accent" className="p-0">
          <div className="flex items-center justify-between gap-4 border-b border-accent-100 px-5 py-4">
            <p className="text-sm font-medium text-slate-700">
              {foundationCount} {foundationCount === 1 ? "foundation" : "foundations"}
            </p>
            <Link href="/portfolio" className="text-sm font-medium text-primary-700 hover:text-primary-800">
              View full portfolio →
            </Link>
          </div>
          <ul className="divide-y divide-accent-100">
            {groupByFoundation(waqfs).map(({ foundation, waqfs: foundationWaqfs }) => (
              // Two separate links side by side, not one nested inside the
              // other (an <a> can't contain another <a>) — same split as
              // each foundation section's header on /portfolio.
              <li
                key={foundation.id}
                // flex-col below sm — the fixed-width "+ Add Waqf Fund"
                // link + icon on the same row as the name left almost no
                // width for the name's own truncation on a narrow phone
                // screen (e.g. "Test Institution NGO" clipped down to
                // "Te…"; found on a 375px viewport, 2026-09-29 codebase
                // walkthrough). Stacking gives the name the full row.
                className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-accent-100/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <Link href="/portfolio" className="flex min-w-0 items-center gap-3 sm:flex-1">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{foundation.name}</span>
                    <span className="block text-xs text-slate-500">
                      {foundationWaqfs.length} waqf {foundationWaqfs.length === 1 ? "fund" : "funds"}
                    </span>
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-4">
                  <Link
                    href={`/foundations/${foundation.id}/waqf-funds/new`}
                    className="text-xs font-medium text-primary-700 hover:text-primary-800"
                  >
                    + Add Waqf Fund
                  </Link>
                  <IconBriefcase className="h-4 w-4 shrink-0 text-slate-300" />
                </div>
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
  const eyebrow = <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Waqf Overview</p>;

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
        // Same auto-fit reasoning as the corpus/raised grid above — the
        // number of statuses present varies (2 to 4), so a fixed column
        // count squeezes tiles too narrow whenever fewer are present.
        <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
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
