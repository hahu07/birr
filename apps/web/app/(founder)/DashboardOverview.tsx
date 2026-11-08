"use client";

// Waqf Overview — the signed-in Founder's home: what they've endowed,
// how it's earmarked, what needs their attention, and what's happened
// recently. The full Foundation/Waqf Fund breakdown lives on /portfolio,
// each fund's detail on /portfolio/[id]. Establishment (Foundation, Waqf
// Fund) is Founder self-service, immediate, no approval gate; ongoing
// governance of an existing Waqf Fund stays exclusively Birr-staff-mediated
// elsewhere — nothing here is a governance control, only a view and
// shortcuts to the Founder's own self-service steps. Rendered by page.tsx
// only once a session exists — see MarketingHome for the signed-out
// counterpart, whose hero (DashboardMockup.tsx) draws this page with
// sample data; keep the two visually in step.
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useFounderSession } from "../../lib/founder-session";
import { apiFetchJson } from "../../lib/api";
import { describeAuditAction, formatMoney, formatRelativeTime } from "../../lib/format";
import { groupByFoundation } from "../../lib/portfolio";
import { FundRow, GeometricPattern, linkButton, Panel, PanelHeader, TYPE_LABEL } from "./_components/ui";
import type { FounderAuditLogEntry, FounderAuditLogPage, PortfolioCauseImpactUpdate, Waqf, WaqfCause } from "../../lib/types";
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
  type NotificationItem,
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
 * per-type split is kept alongside the total and drawn as segments of
 * one bar, so an Investment fund's corpus and a Project fund's corpus
 * stay visibly distinct rather than disappearing into one number.
 */
interface CurrencyPosition {
  currency: string;
  raised: number;
  declared: number;
  fundCount: number;
  byType: { type: Waqf["type"]; raised: number }[];
}

// NGN first — Birr's home currency and its one fully working rail.
function byCurrencyOrder(a: string, b: string) {
  return a === "NGN" ? -1 : b === "NGN" ? 1 : a.localeCompare(b);
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
  return [...map.values()].sort((a, b) => byCurrencyOrder(a.currency, b.currency));
}

// What's still owed on instalment plans, per currency — the same
// "active, on an instalment plan, corpus not yet reached" rule the
// attention list uses below, so the two can never disagree.
function outstandingInstalments(waqfs: Waqf[]) {
  const map = new Map<string, { currency: string; amount: number; funds: string[] }>();
  for (const w of waqfs) {
    if (w.status !== "active" || w.fundingPlan !== "installment" || !w.corpusAmount || !w.corpusCurrency) continue;
    const remaining = Number(w.corpusAmount) - Number(w.amountRaised ?? 0);
    if (remaining <= 0) continue;
    const entry = map.get(w.corpusCurrency) ?? { currency: w.corpusCurrency, amount: 0, funds: [] };
    entry.amount += remaining;
    entry.funds.push(w.name);
    map.set(w.corpusCurrency, entry);
  }
  return [...map.values()].sort((a, b) => byCurrencyOrder(a.currency, b.currency));
}

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  tone: "accent" | "primary";
  icon: "deed" | "fund" | "message";
}

/**
 * Only things the Founder can actually act on themselves, derived from
 * data already loaded — never a governance action (those are Birr
 * staff's, via governed_actions).
 */
function attentionItems(waqfs: Waqf[], unreadMessages: number): AttentionItem[] {
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
        icon: "deed",
      });
    }
  }
  for (const w of waqfs) {
    const item = fundAttentionItem(w);
    if (item) items.push(item);
  }
  if (unreadMessages > 0) {
    items.push({
      key: "messages",
      title: `${unreadMessages} new ${unreadMessages === 1 ? "message" : "messages"}`,
      detail: "From the Birr team looking after your funds.",
      href: "/messages",
      cta: "Read",
      tone: "primary",
      icon: "message",
    });
  }
  return items;
}

/** A draft fund awaiting its first payment, or an instalment fund with corpus still to raise. */
function fundAttentionItem(w: Waqf): AttentionItem | null {
  if (w.status === "draft") {
    return {
      key: `draft-${w.id}`,
      title: "Complete the first contribution",
      detail: `${w.name} becomes active once its first payment is confirmed.`,
      href: `/portfolio/${w.id}/top-up`,
      cta: "Add funds",
      tone: "primary",
      icon: "fund",
    };
  }
  if (w.status !== "active" || w.fundingPlan !== "installment" || !w.corpusAmount || !w.corpusCurrency) return null;
  const remaining = Number(w.corpusAmount) - Number(w.amountRaised ?? 0);
  if (remaining <= 0) return null;
  return {
    key: `installment-${w.id}`,
    title: `${formatMoney(remaining, w.corpusCurrency, { decimals: 0 })} left to fund`,
    detail: `${w.name} is on an instalment plan toward its ${formatMoney(w.corpusAmount, w.corpusCurrency, { decimals: 0 })} corpus.`,
    href: `/portfolio/${w.id}/top-up`,
    cta: "Top up",
    tone: "accent",
    icon: "fund",
  };
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
  const [unreadMessages, setUnreadMessages] = useState(0);
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
    // Side panels — each fails on its own rather than blanking the page.
    apiFetchJson<FounderAuditLogPage>("/audit-logs/me")
      .then((page) => !cancelled && setActivity(page.items.slice(0, 5)))
      .catch(() => !cancelled && setActivity([]));
    // One read, not the shell's 60s poll (useNotifications) — a second
    // polling instance would double that traffic for one badge's worth.
    apiFetchJson<NotificationItem[]>("/notifications")
      .then((items) => !cancelled && setUnreadMessages(items.filter((n) => n.type === "message.received" && !n.readAt).length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [founder]);

  const positions = useMemo(() => (waqfs ? positionsByCurrency(waqfs) : []), [waqfs]);
  const attention = useMemo(() => (waqfs ? attentionItems(waqfs, unreadMessages) : []), [waqfs, unreadMessages]);
  const outstanding = useMemo(() => (waqfs ? outstandingInstalments(waqfs) : []), [waqfs]);
  const foundations = useMemo(() => (waqfs ? groupByFoundation(waqfs).map((g) => g.foundation) : []), [waqfs]);

  if (!founder || !user) return null;

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? user.fullName;
  // "Add Waqf Fund" needs a Foundation to sit under — go straight to it
  // when there's exactly one, otherwise let the Portfolio page choose.
  const addFundHref = foundations.length === 1 ? `/foundations/${foundations[0]!.id}/waqf-funds/new` : "/portfolio";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 pb-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
            {new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Birr serves as Mutawalli (trustee) for <span className="font-medium text-slate-800">{founder.name}</span>
            {foundations.length > 0 && ` across ${foundations.length} ${foundations.length === 1 ? "foundation" : "foundations"}`}
            {waqfs && waqfs.length > 0 && ` and ${waqfs.length} waqf ${waqfs.length === 1 ? "fund" : "funds"}`}.
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
          <div className="grid gap-6 lg:grid-cols-5">
            <EndowmentHero positions={positions} className="lg:col-span-3" />
            <EarmarkPanel waqfs={waqfs} className="lg:col-span-2" />
          </div>

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
              value={distributed && distributed.length > 0 ? null : <span className="text-slate-400">None yet</span>}
              sub={
                distributed && distributed.length > 0 ? (
                  <span className="space-y-0.5">
                    {distributed.map((d) => (
                      <span key={`${d.waqfType}-${d.currency}`} className="block">
                        <span className="font-semibold tabular-nums text-slate-900">{formatMoney(d.totalAmount, d.currency, { decimals: 0 })}</span>{" "}
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
              tone="accent"
              icon={<IconBriefcase className="h-[18px] w-[18px]" />}
              label="Left to fund"
              value={
                outstanding.length === 0 ? (
                  <span className="text-slate-400">Nothing</span>
                ) : outstanding.length === 1 ? (
                  formatMoney(outstanding[0]!.amount, outstanding[0]!.currency, { decimals: 0 })
                ) : null
              }
              sub={
                outstanding.length === 0 ? (
                  "outstanding on instalment plans"
                ) : outstanding.length === 1 ? (
                  outstanding[0]!.funds.length === 1 ? outstanding[0]!.funds[0] : `across ${outstanding[0]!.funds.length} funds`
                ) : (
                  <span className="space-y-0.5">
                    {outstanding.map((o) => (
                      <span key={o.currency} className="block font-semibold tabular-nums text-slate-900">
                        {formatMoney(o.amount, o.currency, { decimals: 0 })}
                      </span>
                    ))}
                  </span>
                )
              }
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-5">
            <FundsPanel waqfs={waqfs} className="lg:col-span-3" />
            <AttentionPanel items={attention} className="lg:col-span-2" />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <ActivityPanel entries={activity} className="lg:col-span-3" />
            <LatestImpactPanel className="lg:col-span-2" />
          </div>
        </>
      )}
    </div>
  );
}

// Investment, Asset and Project each get their own segment colour on the
// dark endowment card — gold for the classical invested endowment.
const TYPE_SEGMENT: Record<Waqf["type"], string> = {
  investment: "bg-accent-500",
  asset: "bg-accent-200",
  project: "bg-primary-300",
};

function EndowmentHero({ positions, className = "" }: { positions: CurrencyPosition[]; className?: string }) {
  return (
    <section
      aria-label="Endowed to date"
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 text-white shadow-lg shadow-primary-950/20 ${className}`}
    >
      <GeometricPattern className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 text-white/[0.07] [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-400/15 blur-3xl" aria-hidden="true" />
      <div className={`relative ${positions.length > 1 ? "divide-y divide-white/10" : ""}`}>
        {positions.length === 0 && (
          <div className="p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">Endowed to date</p>
            <p className="mt-3 text-sm text-primary-100/80">No corpus has been declared on your funds yet.</p>
          </div>
        )}
        {positions.map((p) => {
          const pct = p.declared > 0 ? (p.raised / p.declared) * 100 : null;
          // Segments are each type's share of the declared corpus; if more
          // has been raised than declared, scale them to fill exactly 100%.
          const scale = pct !== null && pct > 100 ? 100 / pct : 1;
          return (
            <div key={p.currency} className="p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">
                Endowed to date{positions.length > 1 && ` · ${p.currency}`}
              </p>
              <p className="mt-3 font-display text-4xl font-medium tabular-nums tracking-tight sm:text-5xl">
                {formatMoney(p.raised, p.currency, { decimals: 0 })}
              </p>
              <p className="mt-2 text-sm text-primary-100/80">
                of {formatMoney(p.declared, p.currency, { decimals: 0 })} declared across {p.fundCount} {p.fundCount === 1 ? "fund" : "funds"}
              </p>
              {pct !== null && (
                <>
                  <div
                    className="mt-6 flex h-2.5 overflow-hidden rounded-full bg-white/10"
                    role="img"
                    aria-label={`${Math.floor(pct)}% of declared corpus funded: ${p.byType
                      .map((t) => `${TYPE_LABEL[t.type]} ${formatMoney(t.raised, p.currency, { decimals: 0 })}`)
                      .join(", ")}`}
                  >
                    {p.byType.map((t) => (
                      <span
                        key={t.type}
                        className={`h-full ${TYPE_SEGMENT[t.type]} transition-[width] duration-700`}
                        style={{ width: `${(t.raised / p.declared) * 100 * scale}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-primary-100/85">
                    {p.byType.map((t) => (
                      <span key={t.type} className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${TYPE_SEGMENT[t.type]}`} aria-hidden="true" />
                        {TYPE_LABEL[t.type]} · <span className="font-semibold tabular-nums text-white">{formatMoney(t.raised, p.currency, { decimals: 0 })}</span>
                      </span>
                    ))}
                    <span className="ml-auto font-semibold text-white">{Math.floor(pct)}% funded</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Slice colours, in order of size — the brand's two hues at distinct
// lightness, so neighbouring slices stay separable for colour-blind
// readers too. "Not yet earmarked" is always the neutral grey.
const SLICE_COLORS = ["#124c3d", "#248f72", "#c48a1b", "#aee1d1", "#eabd4c"];
const UNEARMARKED_COLOR = "#e2e8f0";
const MAX_SLICES = 5;

interface Earmark {
  currency: string;
  raised: number;
  slices: { name: string; amount: number; color: string }[];
  unearmarked: number;
  causeNames: string[];
  hasInvestment: boolean;
}

/** Per currency: each cause's earmark (allocatedAmount), summed by cause name across funds. */
function earmarksByCurrency(waqfs: Waqf[], causesByWaqf: Record<string, WaqfCause[]>): Earmark[] {
  const map = new Map<string, { raised: number; byCause: Map<string, number>; names: Set<string>; hasInvestment: boolean }>();
  for (const w of waqfs) {
    const causes = causesByWaqf[w.id];
    if (!w.corpusCurrency || !causes) continue;
    const e = map.get(w.corpusCurrency) ?? { raised: 0, byCause: new Map(), names: new Set(), hasInvestment: false };
    e.raised += Number(w.amountRaised ?? 0);
    if (w.type === "investment") e.hasInvestment = true;
    for (const c of causes) {
      e.names.add(c.name);
      const amount = Number(c.allocatedAmount ?? 0);
      if (amount > 0) e.byCause.set(c.name, (e.byCause.get(c.name) ?? 0) + amount);
    }
    map.set(w.corpusCurrency, e);
  }
  return [...map.entries()]
    .sort(([a], [b]) => byCurrencyOrder(a, b))
    .map(([currency, e]) => {
      const sorted = [...e.byCause.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted.slice(0, MAX_SLICES - 1);
      const rest = sorted.slice(MAX_SLICES - 1);
      const slices = top.map(([name, amount], i) => ({ name, amount, color: SLICE_COLORS[i]! }));
      if (rest.length === 1) slices.push({ name: rest[0]![0], amount: rest[0]![1], color: SLICE_COLORS[MAX_SLICES - 1]! });
      else if (rest.length > 1) slices.push({ name: `${rest.length} other causes`, amount: rest.reduce((s, [, a]) => s + a, 0), color: SLICE_COLORS[MAX_SLICES - 1]! });
      const earmarked = slices.reduce((s, x) => s + x.amount, 0);
      return { currency, raised: e.raised, slices, unearmarked: Math.max(0, e.raised - earmarked), causeNames: [...e.names], hasInvestment: e.hasInvestment };
    });
}

/**
 * Each fund's selected causes. One request per fund — the founder-scoped
 * /waqf-causes listing is per waqf; a founder holds a handful of funds,
 * not hundreds. `null` while loading.
 */
function useCausesByWaqf(fundIds: string[]) {
  const [causesByWaqf, setCausesByWaqf] = useState<Record<string, WaqfCause[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const fundKey = fundIds.join(",");

  useEffect(() => {
    let cancelled = false;
    Promise.all(fundIds.map((id) => apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${id}`).then((c) => [id, c] as const)))
      .then((pairs) => !cancelled && setCausesByWaqf(Object.fromEntries(pairs)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // fundKey captures fundIds' contents; the array itself is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundKey]);

  return { causesByWaqf, failed };
}

function EarmarkPanel({ waqfs, className = "" }: { waqfs: Waqf[]; className?: string }) {
  const [currency, setCurrency] = useState<string | null>(null);
  const fundIds = waqfs.filter((w) => w.corpusCurrency).map((w) => w.id);
  const { causesByWaqf, failed } = useCausesByWaqf(fundIds);

  const earmarks = useMemo(() => (causesByWaqf ? earmarksByCurrency(waqfs, causesByWaqf) : []), [waqfs, causesByWaqf]);
  const shown = earmarks.find((e) => e.currency === currency) ?? earmarks[0];
  const manageHref = fundIds.length === 1 ? `/portfolio/${fundIds[0]}` : "/portfolio";

  return (
    <Panel className={`flex flex-col ${className}`}>
      <PanelHeader title="How your endowment is earmarked" href={manageHref} linkLabel="Manage" />
      <div className="flex flex-1 flex-col px-5 py-5">
        {failed ? (
          <p className="text-sm text-slate-500">Couldn&apos;t load your causes right now.</p>
        ) : causesByWaqf === null ? (
          <EarmarkSkeleton />
        ) : (
          <EarmarkBody earmark={shown} manageHref={manageHref} />
        )}

        {earmarks.length > 1 && <CurrencyToggle currencies={earmarks.map((e) => e.currency)} active={shown?.currency} onChange={setCurrency} />}

        {shown?.hasInvestment && shown.slices.length > 0 && (
          <p className="mt-auto pt-4 text-xs leading-relaxed text-slate-500">
            For an Investment fund this is a target: the corpus stays invested, and Birr&apos;s Investment Committee allocates its returns across
            these causes.
          </p>
        )}
      </div>
    </Panel>
  );
}

function EarmarkSkeleton() {
  return (
    <div className="flex items-center gap-5">
      <Skeleton className="h-32 w-32 shrink-0 rounded-full" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    </div>
  );
}

/** No causes yet → a prompt to choose them; causes but nothing earmarked → the list; otherwise the donut. */
function EarmarkBody({ earmark, manageHref }: { earmark: Earmark | undefined; manageHref: string }) {
  if (!earmark || earmark.causeNames.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center sm:flex-row sm:text-left">
        <svg viewBox="0 0 120 120" className="h-24 w-24 shrink-0" aria-hidden="true">
          <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" strokeWidth="16" className="text-slate-100" />
          <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" strokeWidth="16" strokeDasharray="6 10" className="text-slate-200" />
        </svg>
        <div>
          <p className="text-sm leading-relaxed text-slate-500">
            Choose the causes your waqf supports, then earmark how its endowment is divided between them.
          </p>
          <Link href={manageHref} className={`${linkButton.secondary} mt-4`}>
            Choose causes
          </Link>
        </div>
      </div>
    );
  }
  if (earmark.slices.length === 0) {
    return (
      <div>
        <p className="text-sm leading-relaxed text-slate-600">Nothing is earmarked yet. Your causes:</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {earmark.causeNames.map((n) => (
            <li key={n} className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800 ring-1 ring-inset ring-primary-100">
              {n}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <EarmarkDonut earmark={earmark} />;
}

function CurrencyToggle({ currencies, active, onChange }: { currencies: string[]; active: string | undefined; onChange: (c: string) => void }) {
  return (
    <div className="mt-4 flex gap-1.5" role="group" aria-label="Currency">
      {currencies.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-pressed={c === active}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            c === active ? "bg-primary-700 text-white" : "border border-slate-200 text-slate-600 hover:border-primary-300"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function EarmarkDonut({ earmark }: { earmark: Earmark }) {
  const total = earmark.slices.reduce((s, x) => s + x.amount, 0) + earmark.unearmarked;
  const size = 132;
  const r = 50;
  const c = 2 * Math.PI * r;
  const segments = [
    ...earmark.slices,
    ...(earmark.unearmarked > 0 ? [{ name: "Not yet earmarked", amount: earmark.unearmarked, color: UNEARMARKED_COLOR }] : []),
  ];
  // Each arc starts where the previous ones end — computed up front rather
  // than by mutating a running total during render.
  const gap = segments.length > 1 ? 1.5 : 0;
  const arcs = segments.map((s, i) => ({
    ...s,
    len: (s.amount / total) * c,
    start: (segments.slice(0, i).reduce((sum, x) => sum + x.amount, 0) / total) * c,
  }));
  const pctOf = (amount: number) => (total > 0 ? Math.round((amount / total) * 100) : 0);

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`Endowment earmarked across causes in ${earmark.currency}: ${segments.map((s) => `${s.name} ${pctOf(s.amount)}%`).join(", ")}`}
        >
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={15} />
          {arcs.map((a) => (
            <circle
              key={a.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={15}
              strokeDasharray={`${Math.max(0, a.len - gap)} ${c}`}
              strokeDashoffset={-a.start}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-medium leading-none text-slate-900">{earmark.slices.length}</span>
          <span className="mt-0.5 text-[11px] text-slate-500">{earmark.slices.length === 1 ? "cause" : "causes"}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {segments.map((s) => (
          <li key={s.name} className="flex items-center gap-2.5 text-sm text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} aria-hidden="true" />
            <span className="truncate">{s.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-900">{pctOf(s.amount)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: "primary" | "accent";
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            tone === "accent" ? "bg-accent-50 text-accent-700" : "bg-primary-50 text-primary-700"
          }`}
        >
          {icon}
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      {value !== null && <p className="mt-3 font-display text-2xl font-medium tabular-nums tracking-tight text-slate-900 sm:text-[1.7rem]">{value}</p>}
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

const ATTENTION_ICON = { deed: IconFileText, fund: IconBriefcase, message: IconMessageCircle } as const;

function AttentionPanel({ items, className = "" }: { items: AttentionItem[]; className?: string }) {
  return (
    <Panel className={className}>
      <PanelHeader
        title="Needs your attention"
        aside={
          items.length > 0 ? (
            <span className="rounded-full bg-accent-100 px-2 text-[11px] font-bold leading-5 text-accent-800">{items.length}</span>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <IconCheckCircle className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-900">You&apos;re all caught up</p>
            <p className="text-xs text-slate-500">Nothing is waiting on you right now.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 5).map((item) => {
            const Icon = ATTENTION_ICON[item.icon];
            return (
              <li key={item.key} className="flex items-start gap-3 px-5 py-4">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    item.tone === "accent" ? "bg-accent-50 text-accent-700" : "bg-primary-50 text-primary-700"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.detail}</p>
                </div>
                <Link href={item.href} className={`${linkButton.quiet} mt-1 shrink-0`}>
                  {item.cta}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel({ entries, className = "" }: { entries: FounderAuditLogEntry[] | null; className?: string }) {
  return (
    <Panel className={className}>
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
                <p className="text-sm font-medium text-slate-800">{describeAuditAction(e.action)}</p>
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

// The most recent impact update across the founder's own causes — the
// same founder-scoped GET /cause-impact-updates the Impact page lists.
function LatestImpactPanel({ className = "" }: { className?: string }) {
  const [latest, setLatest] = useState<PortfolioCauseImpactUpdate | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<PortfolioCauseImpactUpdate[]>("/cause-impact-updates")
      .then((updates) => {
        if (cancelled) return;
        const newest = [...updates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        setLatest(newest ?? null);
      })
      .catch(() => !cancelled && setLatest(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={`flex flex-col rounded-2xl border border-accent-100 bg-accent-50 p-5 shadow-sm sm:p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent-700">
          Latest impact{latest ? ` · ${latest.waqfCause.name}` : ""}
        </p>
        <Link href="/impact" className={linkButton.quiet}>
          All impact
          <IconArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {latest === undefined ? (
        <div className="mt-4 space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : latest === null ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          When Birr reports what your causes achieved, the latest update will appear here.
        </p>
      ) : (
        <>
          <blockquote className="mt-3 line-clamp-4 font-display text-lg italic leading-snug text-slate-900">
            &ldquo;{latest.narrative}&rdquo;
          </blockquote>
          {latest.metricValue !== null && latest.metricLabel && (
            <p className="mt-3 text-sm text-slate-700">
              <span className="font-display text-xl font-medium tabular-nums text-slate-900">{latest.metricValue.toLocaleString("en-NG")}</span>{" "}
              {latest.metricLabel}
            </p>
          )}
          <p className="mt-auto pt-4 text-xs text-slate-500">
            {latest.periodLabel} · {latest.waqfCause.waqf.name} · reported by {latest.reportedByUser.fullName}
          </p>
        </>
      )}
    </section>
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
      <GeometricPattern className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 text-primary-900/[0.05]" />
      <div className="relative max-w-2xl">
        <h2 className="font-display text-2xl font-medium tracking-tight text-slate-900">Begin your endowment</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          It takes a few minutes, entirely self-service — Birr becomes Mutawalli (trustee) the moment your first fund is established.
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
    <div className="space-y-6" aria-busy="true" aria-label="Loading your overview">
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-56 rounded-2xl lg:col-span-3" />
        <Skeleton className="h-56 rounded-2xl lg:col-span-2" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-2xl lg:col-span-3" />
        <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
      </div>
    </div>
  );
}
