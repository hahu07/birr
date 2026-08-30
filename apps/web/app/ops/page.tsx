"use client";

// Ops Console landing page — platform-wide statistics across every
// Foundation/Waqf Fund Birr manages (the Ops-side counterpart to the
// Founder Portal's own DashboardOverview.tsx, which already shows a
// hero stat + status breakdown for a signed-in Founder's own waqf).
// Deliberately separate from "My Desk" (app/ops/my-desk/page.tsx) —
// this page is the same for every staff member regardless of caseload;
// My Desk is personal and, per the sidebar's own filtering (see
// app-shell.tsx's hasCaseload prop), only even appears in the nav for
// staff who actually have one. Numbers are computed client-side from
// the already-unscoped GET /foundations and GET /waqfs responses (any
// Birr staff session sees every Foundation/Waqf Fund, no founder-scoping
// applies here), plus two small dedicated aggregate endpoints for money
// actually moved — ContributionsService.platformSummary (confirmed
// contributions) and DistributionsService.platformSummary (paid
// distributions), both grouped by currency, never blended (same
// reasoning as Distribution.currency's own schema comment). Declared
// corpus (Waqf.corpusAmount) comes straight off the list response; the
// two money totals needed their own routes since Waqf.amountRaised is
// only computed on GET /waqfs/:id, not the list.
import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { humanize, formatAmount } from "../../lib/format";
import type { Foundation, Waqf } from "../../lib/ops-types";
import {
  Alert,
  Card,
  DonutChart,
  IconArchive,
  IconBriefcase,
  IconCheckCircle,
  IconClipboardCheck,
  IconClock,
  IconHome,
  IconLandmark,
  IconXCircle,
  Skeleton,
  StatCard,
} from "@birr/ui";
import type { DonutChartSegment } from "@birr/ui";

const WAQF_STATUS_TONE: Record<Waqf["status"], "neutral" | "primary" | "success" | "warning"> = {
  active: "success",
  draft: "neutral",
  suspended: "warning",
  dissolved: "neutral",
};

const WAQF_STATUS_ICON: Record<Waqf["status"], typeof IconCheckCircle> = {
  active: IconCheckCircle,
  draft: IconClock,
  suspended: IconXCircle,
  dissolved: IconArchive,
};

// Chart colors — drawn from the same three brand hues (primary/accent/
// violet) StatCard tones already use, plus slate as the fourth neutral
// segment, so the donut legend reads as an extension of the tile colors
// above it rather than an unrelated palette.
const WAQF_STATUS_COLOR: Record<Waqf["status"], string> = {
  active: "var(--color-primary-600)",
  draft: "#94a3b8",
  suspended: "var(--color-accent-500)",
  dissolved: "#475569",
};

const WAQF_TYPE_COLOR: Record<Waqf["type"], string> = {
  investment: "var(--color-violet-600)",
  asset: "var(--color-primary-600)",
  project: "var(--color-accent-500)",
  hybrid: "#64748b",
};

// GET /contributions/platform-summary and GET /distributions/platform-summary
// — confirmed-only total (currency only) and paid-only total (waqf type +
// currency) across every waqf. Distributed is split by waqf type, never
// blended — an Investment-type waqf's distributions can draw on the
// separate, staff-governed proceeds pool on top of corpus, every other
// type only ever spends corpus (see DistributionsService.platformSummary's
// own comment). Raised has no such split — WaqfProceeds never counts
// toward "raised" for any waqf type (see CLAUDE.md's Cause Allocation
// section).
interface CurrencyTotal {
  currency: string;
  totalAmount: string;
}

interface DistributedTotal extends CurrencyTotal {
  waqfType: Waqf["type"];
}

export default function OpsConsoleHome() {
  const [foundations, setFoundations] = useState<Foundation[] | null>(null);
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [raised, setRaised] = useState<CurrencyTotal[] | null>(null);
  const [distributed, setDistributed] = useState<DistributedTotal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetchJson<Foundation[]>("/foundations"),
      apiFetchJson<Waqf[]>("/waqfs"),
      apiFetchJson<CurrencyTotal[]>("/contributions/platform-summary"),
      apiFetchJson<DistributedTotal[]>("/distributions/platform-summary"),
    ])
      .then(([f, w, r, d]) => {
        if (cancelled) return;
        setFoundations(f);
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
  }, []);

  const stats = useMemo(() => {
    if (!waqfs) return null;
    const byStatus = waqfs.reduce(
      (acc, w) => {
        acc[w.status] += 1;
        return acc;
      },
      { active: 0, draft: 0, suspended: 0, dissolved: 0 } as Record<Waqf["status"], number>,
    );
    const byType = waqfs.reduce(
      (acc, w) => {
        acc[w.type] += 1;
        return acc;
      },
      { investment: 0, asset: 0, project: 0, hybrid: 0 } as Record<Waqf["type"], number>,
    );
    // Keyed by (type, currency), not currency alone — same reasoning as
    // the Distributed split above: an Investment waqf's corpus and a
    // Project waqf's corpus carry different fiduciary character (one
    // waqf type can go on to accrue investment proceeds, the others
    // never do), so blending them into one "Declared corpus" figure
    // hides that distinction. See DistributedTotal's own comment.
    const corpusByTypeAndCurrency = new Map<string, number>();
    for (const w of waqfs) {
      if (!w.corpusAmount || !w.corpusCurrency) continue;
      const key = `${w.type}:${w.corpusCurrency}`;
      corpusByTypeAndCurrency.set(key, (corpusByTypeAndCurrency.get(key) ?? 0) + Number(w.corpusAmount));
    }
    return { byStatus, byType, corpusByTypeAndCurrency };
  }, [waqfs]);

  const statusSegments: DonutChartSegment[] = useMemo(() => {
    if (!stats) return [];
    return (Object.keys(stats.byStatus) as Waqf["status"][]).map((status) => ({
      label: humanize(status),
      value: stats.byStatus[status],
      color: WAQF_STATUS_COLOR[status],
    }));
  }, [stats]);

  const typeSegments: DonutChartSegment[] = useMemo(() => {
    if (!stats) return [];
    return (Object.keys(stats.byType) as Waqf["type"][]).map((type) => ({
      label: humanize(type),
      value: stats.byType[type],
      color: WAQF_TYPE_COLOR[type],
    }));
  }, [stats]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconHome className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Overview</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Platform-wide statistics across every Foundation and Waqf Fund Birr manages.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load platform overview" className="mb-8">
          {error}
        </Alert>
      )}

      {!error && (!foundations || !waqfs || !stats || !raised || !distributed) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px] w-full rounded-lg" />
          ))}
        </div>
      )}

      {!error && foundations && waqfs && stats && raised && distributed && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Foundations"
              value={foundations.length}
              tone="primary"
              icon={<IconLandmark className="h-[18px] w-[18px]" />}
            />
            <StatCard
              label="Waqf Funds"
              value={waqfs.length}
              tone="primary"
              icon={<IconBriefcase className="h-[18px] w-[18px]" />}
            />
            {(Object.keys(stats.byStatus) as Waqf["status"][])
              .filter((s) => stats.byStatus[s] > 0)
              .map((status) => {
                const Icon = WAQF_STATUS_ICON[status];
                return (
                  <StatCard
                    key={status}
                    label={`${humanize(status)} funds`}
                    value={stats.byStatus[status]}
                    tone={WAQF_STATUS_TONE[status]}
                    icon={<Icon className="h-[18px] w-[18px]" />}
                  />
                );
              })}
          </div>

          {(stats.corpusByTypeAndCurrency.size > 0 || raised.length > 0 || distributed.length > 0) && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[...stats.corpusByTypeAndCurrency.entries()].map(([key, amount]) => {
                const [type, currency] = key.split(":") as [Waqf["type"], string];
                return (
                  <StatCard
                    key={`corpus-${key}`}
                    label={`Declared corpus — ${humanize(type)} (${currency})`}
                    value={formatAmount(amount)}
                    tone="neutral"
                    icon={<IconLandmark className="h-[18px] w-[18px]" />}
                  />
                );
              })}
              {raised.map((r) => (
                <StatCard
                  key={`raised-${r.currency}`}
                  label={`Raised (${r.currency})`}
                  value={formatAmount(r.totalAmount)}
                  tone="success"
                  icon={<IconCheckCircle className="h-[18px] w-[18px]" />}
                />
              ))}
              {distributed.map((d) => (
                <StatCard
                  key={`distributed-${d.waqfType}-${d.currency}`}
                  label={`Distributed via ${humanize(d.waqfType)} funds (${d.currency})`}
                  value={formatAmount(d.totalAmount)}
                  tone="primary"
                  icon={<IconClipboardCheck className="h-[18px] w-[18px]" />}
                />
              ))}
            </div>
          )}

          <Card className="mt-2">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Fund composition</h2>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <div>
                <p className="mb-3 text-xs font-medium text-slate-500">By status</p>
                <DonutChart segments={statusSegments} centerLabel="funds" />
              </div>
              <div>
                <p className="mb-3 text-xs font-medium text-slate-500">By type</p>
                <DonutChart segments={typeSegments} centerLabel="funds" />
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
