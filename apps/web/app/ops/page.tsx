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
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { humanize, formatMoney, WAQF_STATUS_CHART_COLOR, humanizeRoles } from "../../lib/format";
import { useNotifications } from "../../lib/notifications";
import { useStaffSession } from "../../lib/staff-session";
import type { Foundation, FounderRequest, GovernedAction, Waqf } from "../../lib/ops-types";
import {
  Alert,
  Card,
  DonutChart,
  IconArchive,
  IconBriefcase,
  IconCheckCircle,
  IconClipboardCheck,
  IconClock,
  IconChevronRight,
  IconHome,
  IconInbox,
  IconLandmark,
  IconMessageCircle,
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

const WAQF_TYPE_COLOR: Record<Waqf["type"], string> = {
  investment: "var(--color-violet-600)",
  asset: "var(--color-primary-600)",
  project: "var(--color-accent-500)",
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

  // "Your desk" — what's waiting on this officer, fetched apart from the
  // platform figures so a failure here never blanks the page. Approvals
  // exclude their own proposals (maker ≠ checker, so they could never
  // decide those) — the same rule the sidebar's Approvals badge uses.
  const { staff } = useStaffSession();
  const { notifications } = useNotifications(true);
  const [desk, setDesk] = useState<{ approvals: number; requests: number } | null>(null);
  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    Promise.all([apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed"), apiFetchJson<FounderRequest[]>("/founder-requests")])
      .then(([actions, requests]) => {
        if (cancelled) return;
        setDesk({
          approvals: actions.filter((a) => a.makerUserId !== staff.userId).length,
          requests: requests.filter((r) => r.status !== "actioned" && r.status !== "declined").length,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [staff]);
  const unreadMessages = notifications.filter((n) => n.type === "message.received" && !n.readAt).length;

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
      { investment: 0, asset: 0, project: 0 } as Record<Waqf["type"], number>,
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
      color: WAQF_STATUS_CHART_COLOR[status],
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

  const firstName = staff?.user.fullName.trim().split(/\s+/)[0];

  return (
    <div className="space-y-8">
      <header className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconHome className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{firstName ? `Welcome back, ${firstName}` : "Overview"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {staff && <span className="font-medium text-slate-700">{humanizeRoles(staff.roles)}</span>}
            {staff && " · "}
            Platform-wide figures across every Foundation and Waqf Fund Birr manages.
          </p>
        </div>
      </header>

      <section aria-label="Your desk">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Your desk</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <DeskTile
            href="/ops/governed-actions"
            icon={<IconClipboardCheck className="h-5 w-5" />}
            count={desk?.approvals ?? null}
            label="Approvals awaiting your decision"
            hint="Your own proposals excluded"
            emphasis
          />
          <DeskTile
            href="/ops/founder-requests"
            icon={<IconInbox className="h-5 w-5" />}
            count={desk?.requests ?? null}
            label="Open Founder requests"
            hint="Not yet actioned or declined"
          />
          <DeskTile href="/ops/messages" icon={<IconMessageCircle className="h-5 w-5" />} count={unreadMessages} label="Unread messages" hint="From Founders" />
        </div>
      </section>

      {error && (
        <Alert tone="danger" title="Couldn't load platform overview">
          {error}
        </Alert>
      )}

      {!error && (!foundations || !waqfs || !stats || !raised || !distributed) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px] w-full rounded-xl" />
          ))}
        </div>
      )}

      {!error && foundations && waqfs && stats && raised && distributed && (
        <>
          <section aria-label="Platform">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Platform</h2>
            {/* auto-fit/minmax, not a fixed column count — this grid mixes
                2 always-present tiles with a variable number of per-status
                tiles, and a fixed split squeezed every tile too narrow
                whenever the total was below 4 (2026-09-29 walkthrough). */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
              <StatCard label="Foundations" value={foundations.length} tone="primary" icon={<IconLandmark className="h-[18px] w-[18px]" />} />
              <StatCard label="Waqf Funds" value={waqfs.length} tone="primary" icon={<IconBriefcase className="h-[18px] w-[18px]" />} />
              {(Object.keys(stats.byStatus) as Waqf["status"][])
                .filter((st) => stats.byStatus[st] > 0)
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
          </section>

          {(stats.corpusByTypeAndCurrency.size > 0 || raised.length > 0 || distributed.length > 0) && (
            <section aria-label="Money under trusteeship" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Money under trusteeship</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Per currency, never converted; declared corpus and distributions stay split by fund type.
                </p>
              </div>
              <div className="grid divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
                <MoneyColumn
                  title="Raised"
                  rows={raised.map((r) => ({ key: r.currency, label: r.currency, amount: r.totalAmount, currency: r.currency }))}
                />
                <MoneyColumn
                  title="Declared corpus"
                  rows={[...stats.corpusByTypeAndCurrency.entries()].map(([key, amount]) => {
                    const [type, currency] = key.split(":") as [Waqf["type"], string];
                    return { key, label: `${humanize(type)} · ${currency}`, amount, currency };
                  })}
                />
                <MoneyColumn
                  title="Distributed"
                  rows={distributed.map((d) => ({
                    key: `${d.waqfType}-${d.currency}`,
                    label: `${humanize(d.waqfType)} · ${d.currency}`,
                    amount: d.totalAmount,
                    currency: d.currency,
                  }))}
                />
              </div>
            </section>
          )}

          <Card>
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

function DeskTile({
  href,
  icon,
  count,
  label,
  hint,
  emphasis = false,
}: {
  href: string;
  icon: ReactNode;
  count: number | null;
  label: string;
  hint: string;
  emphasis?: boolean;
}) {
  const active = emphasis && (count ?? 0) > 0;
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-2xl border p-4 shadow-sm transition-colors ${
        active ? "border-primary-800 bg-primary-900 text-white hover:bg-primary-800" : "border-slate-200/80 bg-white hover:border-slate-300"
      }`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${active ? "bg-white/10 text-accent-300" : "bg-primary-50 text-primary-700"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-2xl font-semibold tabular-nums ${active ? "text-white" : "text-slate-900"}`}>{count ?? "—"}</span>
        <span className={`block text-sm font-medium ${active ? "text-primary-50" : "text-slate-700"}`}>{label}</span>
        <span className={`block text-xs ${active ? "text-primary-200" : "text-slate-500"}`}>{hint}</span>
      </span>
      <IconChevronRight className={`h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 ${active ? "text-primary-200" : "text-slate-300"}`} />
    </Link>
  );
}

function MoneyColumn({ title, rows }: { title: string; rows: { key: string; label: string; amount: string | number; currency: string }[] }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">None yet</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-slate-500">{r.label}</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{formatMoney(r.amount, r.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
