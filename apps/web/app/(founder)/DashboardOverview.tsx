"use client";

// Waqf Overview — the signed-in Founder's home: what they've endowed,
// what needs their attention, and what's happened recently. The full
// Foundation/Waqf Fund breakdown lives on /portfolio, each fund's detail
// on /portfolio/[id]. Establishment (Foundation, Waqf Fund) is Founder
// self-service, immediate, no approval gate; ongoing governance of an
// existing Waqf Fund stays exclusively Birr-staff-mediated elsewhere —
// nothing here is a governance control, only a view and shortcuts to the
// Founder's own self-service steps. Rendered by page.tsx only once a
// session exists — see MarketingHome for the signed-out counterpart.
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useFounderSession } from "../../lib/founder-session";
import { apiFetchJson } from "../../lib/api";
import { describeAuditAction, formatMoney, formatRelativeTime } from "../../lib/format";
import { groupByFoundation } from "../../lib/portfolio";
import { FundRow, GeometricPattern, linkButton, Panel, PanelHeader, ProgressBar, TYPE_LABEL } from "./_components/ui";
import type { FounderAuditLogEntry, FounderAuditLogPage, Waqf } from "../../lib/types";
import {
  Alert,
  IconArrowRight,
  IconBriefcase,
  IconCheckCircle,
  IconClipboardCheck,
  IconFileText,
  IconHeart,
  IconLandmark,
  IconMessageCircle,
  IconPlus,
  Skeleton,
} from "@birr/ui";

// Distributed money is kept split by waqf type, never blended into one
// figure — an Investment-type waqf's distributions draw on
// WaqfCause.proceedsAllocatedAmount (investment returns) ALONE, per the
// 2026-09-04 decision (corpus is no longer itself distributable for
// Investment funds), while every other type only ever spends corpus.
// Folding both into one "Distributed" number would silently mix money
// with two different fiduciary characters. See DistributionsService
// .founderSummary's own comment.
interface DistributedTotal {
  currency: string;
  totalAmount: string;
  waqfType: Waqf["type"];
}

/**
 * Raised vs. declared corpus, one entry per currency — never converted
 * or added across currencies (no exchange-rate feed, by design; same
 * posture as Vault's per-currency totals). Within a currency, the
 * per-type split is kept alongside the total and shown under it, so an
 * Investment fund's corpus and a Project fund's corpus stay visibly
 * distinct rather than disappearing into one number.
 */
interface CurrencyPosition {
  currency: string;
  raised: number;
  declared: number;
  fundCount: number;
  byType: { type: Waqf["type"]; raised: number }[];
}

function positionsByCurrency(waqfs: Waqf[]): CurrencyPosition[] {
  const map = new Map<string, CurrencyPosition>();
  for (const w of waqfs) {
    if (!w.corpusCurrency) continue;
    const p = map.get(w.corpusCurrency) ?? { currency: w.corpusCurrency, raised: 0, declared: 0, fundCount: 0, byType: [] };
    const raised = Number(w.amountRaised ?? 0);
    p.raised += raised;
    p.declared += Number(w.corpusAmount ?? 0);
    p.fundCount += 1;
    const t = p.byType.find((b) => b.type === w.type);
    if (t) t.raised += raised;
    else p.byType.push({ type: w.type, raised });
    map.set(w.corpusCurrency, p);
  }
  for (const p of map.values()) p.byType.sort((a, b) => b.raised - a.raised);
  // NGN first — Birr's home currency and its one fully working rail.
  return [...map.values()].sort((a, b) => (a.currency === "NGN" ? -1 : b.currency === "NGN" ? 1 : a.currency.localeCompare(b.currency)));
}

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  tone: "accent" | "primary";
}

/**
 * Only things the Founder can actually act on themselves, derived from
 * data already loaded — never a governance action (those are Birr
 * staff's, via governed_actions).
 */
function attentionItems(waqfs: Waqf[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const { foundation } of groupByFoundation(waqfs)) {
    if (!foundation.foundationDeed) {
      items.push({
        key: `deed-${foundation.id}`,
        title: "Sign the Foundation Deed",
        detail: `${foundation.name} has no signed deed yet — it formally appoints Birr as Mutawalli.`,
        href: `/foundations/${foundation.id}/deed`,
        cta: "Review & sign",
        tone: "accent",
      });
    }
  }
  for (const w of waqfs) {
    if (w.status === "draft") {
      items.push({
        key: `draft-${w.id}`,
        title: "Complete the first contribution",
        detail: `${w.name} becomes active once its first payment is confirmed.`,
        href: `/portfolio/${w.id}/top-up`,
        cta: "Add funds",
        tone: "primary",
      });
    } else if (w.status === "active" && w.fundingPlan === "installment" && w.corpusAmount && w.corpusCurrency) {
      const remaining = Number(w.corpusAmount) - Number(w.amountRaised ?? 0);
      if (remaining > 0) {
        items.push({
          key: `installment-${w.id}`,
          title: `${formatMoney(remaining, w.corpusCurrency, { decimals: 0 })} left to fund`,
          detail: `${w.name} is on an installment plan toward its ${formatMoney(w.corpusAmount, w.corpusCurrency, { decimals: 0 })} corpus.`,
          href: `/portfolio/${w.id}/top-up`,
          cta: "Top up",
          tone: "primary",
        });
      }
    }
  }
  return items;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardOverview() {
  // AppShell only renders this page once `founder` has resolved (see
  // app-shell.tsx) — the null checks below are for TypeScript.
  const { founder, user } = useFounderSession();
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [distributed, setDistributed] = useState<DistributedTotal[] | null>(null);
  const [activity, setActivity] = useState<FounderAuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!founder) return;
    let cancelled = false;
    Promise.all([apiFetchJson<Waqf[]>("/waqfs"), apiFetchJson<DistributedTotal[]>("/distributions/founder-summary")])
      .then(([w, d]) => {
        if (cancelled) return;
        setWaqfs(w);
        setDistributed(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    // Recent activity is a side panel — its failure shouldn't blank the
    // whole page, so it's fetched (and fails) on its own.
    apiFetchJson<FounderAuditLogPage>("/audit-logs/me")
      .then((page) => !cancelled && setActivity(page.items.slice(0, 6)))
      .catch(() => !cancelled && setActivity([]));
    return () => {
      cancelled = true;
    };
  }, [founder]);

  const positions = useMemo(() => (waqfs ? positionsByCurrency(waqfs) : []), [waqfs]);
  const attention = useMemo(() => (waqfs ? attentionItems(waqfs) : []), [waqfs]);
  const foundations = useMemo(() => (waqfs ? groupByFoundation(waqfs).map((g) => g.foundation) : []), [waqfs]);

  if (!founder || !user) return null;

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? user.fullName;
  // "Add Waqf Fund" needs a Foundation to sit under — go straight to it
  // when there's exactly one, otherwise let the Portfolio page choose.
  const addFundHref = foundations.length === 1 ? `/foundations/${foundations[0]!.id}/waqf-funds/new` : "/portfolio";

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
            {new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Birr serves as Mutawalli (trustee) for <span className="font-medium text-slate-800">{founder.name}</span>
            {foundations.length > 0 &&
              ` across ${foundations.length} ${foundations.length === 1 ? "foundation" : "foundations"}`}
            .
          </p>
        </div>
        {waqfs && waqfs.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            <Link href="/messages" className={linkButton.secondary}>
              <IconMessageCircle className="h-4 w-4" />
              Message Birr
            </Link>
            <Link href={addFundHref} className={linkButton.primary}>
              <IconPlus className="h-4 w-4" />
              Add Waqf Fund
            </Link>
          </div>
        )}
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load your overview">
          {error}
        </Alert>
      )}

      {!error && waqfs === null && <OverviewSkeleton />}

      {!error && waqfs !== null && waqfs.length === 0 && <WelcomePanel />}

      {!error && waqfs !== null && waqfs.length > 0 && (
        <>
          <EndowmentHero positions={positions} />

          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiTile
              icon={<IconCheckCircle className="h-[18px] w-[18px]" />}
              label="Active funds"
              value={String(waqfs.filter((w) => w.status === "active").length)}
              sub={`of ${waqfs.length} established`}
            />
            <KpiTile
              icon={<IconHeart className="h-[18px] w-[18px]" />}
              label="Causes supported"
              value={String(waqfs.reduce((sum, w) => sum + (w.causesCount ?? 0), 0))}
              sub={`across ${waqfs.length} ${waqfs.length === 1 ? "fund" : "funds"}`}
            />
            <KpiTile
              icon={<IconClipboardCheck className="h-[18px] w-[18px]" />}
              label="Distributed"
              value={
                distributed && distributed.length > 0 ? null : <span className="text-slate-400">None yet</span>
              }
              sub={
                distributed && distributed.length > 0 ? (
                  <span className="space-y-0.5">
                    {distributed.map((d) => (
                      <span key={`${d.waqfType}-${d.currency}`} className="block">
                        <span className="font-semibold tabular-nums text-slate-900">
                          {formatMoney(d.totalAmount, d.currency, { decimals: 0 })}
                        </span>{" "}
                        <span className="text-slate-500">via {TYPE_LABEL[d.waqfType]}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  "Paid out to beneficiaries"
                )
              }
            />
            <KpiTile
              icon={<IconLandmark className="h-[18px] w-[18px]" />}
              label="Foundations"
              value={String(foundations.length)}
              sub={`${foundations.filter((f) => f.foundationDeed).length} with a signed deed`}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <FundsPanel waqfs={waqfs} className="lg:col-span-2" />
            <div className="space-y-6">
              <AttentionPanel items={attention} />
              <ActivityPanel entries={activity} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EndowmentHero({ positions }: { positions: CurrencyPosition[] }) {
  return (
    <section
      aria-label="Endowed to date"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 text-white shadow-lg shadow-primary-950/20"
    >
      <GeometricPattern className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 text-white/[0.06] [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-400/15 blur-3xl" aria-hidden="true" />
      <div
        className={`relative grid gap-8 p-6 sm:p-8 ${positions.length > 1 ? "md:grid-cols-2 md:divide-x md:divide-white/10" : ""}`}
      >
        {positions.length === 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">Endowed to date</p>
            <p className="mt-3 text-sm text-primary-100/80">No corpus has been declared on your funds yet.</p>
          </div>
        )}
        {positions.map((p, i) => {
          const pct = p.declared > 0 ? Math.min(100, (p.raised / p.declared) * 100) : null;
          return (
            <div key={p.currency} className={i > 0 ? "md:pl-8" : ""}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">
                Endowed to date{positions.length > 1 && ` · ${p.currency}`}
              </p>
              <p className="mt-3 font-display text-4xl font-medium tabular-nums tracking-tight sm:text-5xl">
                {formatMoney(p.raised, p.currency, { decimals: 0 })}
              </p>
              <p className="mt-2 text-sm text-primary-100/80">
                of {formatMoney(p.declared, p.currency, { decimals: 0 })} declared across {p.fundCount}{" "}
                {p.fundCount === 1 ? "fund" : "funds"}
              </p>
              {pct !== null && (
                <div className="mt-5">
                  <ProgressBar pct={pct} tone="gold" label={`${Math.round(pct)}% of declared corpus funded`} />
                  <p className="mt-2 text-xs font-medium text-primary-100/80">{Math.floor(pct)}% funded</p>
                </div>
              )}
              {p.byType.length > 1 && (
                <ul className="mt-5 flex flex-wrap gap-2" aria-label="By fund type">
                  {p.byType.map((t) => (
                    <li key={t.type} className="rounded-full bg-white/10 px-3 py-1 text-xs text-primary-50 ring-1 ring-inset ring-white/10">
                      {TYPE_LABEL[t.type]} · <span className="font-semibold tabular-nums">{formatMoney(t.raised, p.currency, { decimals: 0 })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function KpiTile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-700">{icon}</span>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      {value !== null && <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>}
      <p className={`text-xs leading-relaxed text-slate-500 ${value !== null ? "mt-1" : "mt-3 text-sm"}`}>{sub}</p>
    </div>
  );
}

const FUNDS_SHOWN = 6;

function FundsPanel({ waqfs, className = "" }: { waqfs: Waqf[]; className?: string }) {
  return (
    <Panel className={className}>
      <PanelHeader title="Your waqf funds" href="/portfolio" linkLabel={waqfs.length > FUNDS_SHOWN ? `View all ${waqfs.length}` : "Portfolio"} />
      <ul className="divide-y divide-slate-100">
        {waqfs.slice(0, FUNDS_SHOWN).map((w) => (
          <li key={w.id}>
            <FundRow waqf={w} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <Panel>
      <PanelHeader title="Needs your attention" />
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <IconCheckCircle className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-900">You're all caught up</p>
            <p className="text-xs text-slate-500">Nothing is waiting on you right now.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 5).map((item) => (
            <li key={item.key} className="flex gap-3 px-5 py-4">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.tone === "accent" ? "bg-accent-500" : "bg-primary-500"}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.detail}</p>
                <Link href={item.href} className={`${linkButton.quiet} mt-2`}>
                  {item.cta}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel({ entries }: { entries: FounderAuditLogEntry[] | null }) {
  return (
    <Panel>
      <PanelHeader title="Recent activity" href="/activity" linkLabel="View all" />
      {entries === null ? (
        <div className="space-y-3 px-5 py-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : entries.length === 0 ? (
        <p className="px-5 py-5 text-sm text-slate-500">Actions you and your team take will show up here.</p>
      ) : (
        <ol className="relative px-5 py-4">
          {entries.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < entries.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200" aria-hidden="true" />}
              <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-primary-500 bg-white" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm text-slate-800">{describeAuditAction(e.action)}</p>
                <p className="text-xs text-slate-500">
                  {e.actorUser ? `${e.actorUser.fullName} · ` : ""}
                  {formatRelativeTime(e.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function WelcomePanel() {
  const steps = [
    { icon: IconLandmark, title: "Establish a Foundation", body: "The umbrella your Waqf Funds sit under." },
    { icon: IconBriefcase, title: "Create a Waqf Fund", body: "Choose Investment, Asset or Project, and declare its corpus." },
    { icon: IconFileText, title: "Sign the deed", body: "One Foundation Deed appoints Birr as Mutawalli for every fund." },
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-10">
      <GeometricPattern className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 text-primary-900/[0.04]" />
      <div className="relative max-w-2xl">
        <h2 className="font-display text-2xl font-medium tracking-tight text-slate-900">Begin your endowment</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          It takes a few minutes, entirely self-service — Birr becomes Mutawalli (trustee) the moment your first fund is
          established.
        </p>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-700 text-xs font-bold text-white">{i + 1}</span>
              <p className="mt-3 text-sm font-semibold text-slate-900">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.body}</p>
            </li>
          ))}
        </ol>
        <Link href="/foundations/new" className={`${linkButton.primary} mt-6`}>
          Establish a Foundation
          <IconArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading your overview">
      <Skeleton className="h-52 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}
