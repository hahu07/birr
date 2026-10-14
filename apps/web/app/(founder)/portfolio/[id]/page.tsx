"use client";

// Waqf Fund detail — the full breakdown that used to be crammed into
// the Overview page's cards. Reached from /portfolio. Causes, Assets,
// Investments, Distributions, Beneficiaries, and Governance Activity
// each have their own Founder-facing surface below — all read-only
// (registration/disposal/approval stay Birr-staff-mediated), and
// Beneficiaries/Distributions are aggregates rather than individual rows
// (see those components' own comments on why beneficiary identity never
// crosses into this portal).
//
// 2026-09-29 redesign — up to twelve of these sections used to be
// stacked in one continuous scroll inside a single Card, every one of
// them fetching on mount regardless of whether anyone was looking at
// it: opening this page fired 8-10 parallel API calls up front, and
// finding e.g. "has my request been actioned" meant scrolling past
// funding progress, causes, assets, investments and distributions
// first. Grouped into five tabs by what a founder actually comes here
// to do — check status, follow the money, see what's held/who's
// helped, track a request, or pull a report — rather than by entity.
// Each of the twelve section components below is completely unchanged;
// the fix is purely which ones get mounted, and when.
import Link from "next/link";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, formatMoney, humanize } from "../../../../lib/format";
import { STATUS_ICON, STATUS_TONE } from "../../../../lib/portfolio";
import { GeometricPattern, Panel, ProgressBar } from "../../_components/ui";
import { useMarkNotificationsReadForEntity } from "../../../../lib/notifications";
import type { Waqf } from "../../../../lib/types";
import {
  Alert,
  Badge,
  IconArrowRight,
  IconPlus,
  Skeleton,
  Tabs,
  IconHome,
  IconClipboardCheck,
  IconArchive,
  IconInbox,
  IconFileText,
} from "@birr/ui";
import { ContributionsSection } from "./ContributionsSection";
import { CausesSection } from "./CausesSection";
import { AssetsSection } from "./AssetsSection";
import { InvestmentsSection } from "./InvestmentsSection";
import { ProceedsSection } from "./ProceedsSection";
import { DistributionsSection } from "./DistributionsSection";
import { BeneficiariesSection } from "./BeneficiariesSection";
import { GovernanceActivitySection } from "./GovernanceActivitySection";
import { RequestsSection } from "./RequestsSection";
import { FinancialReportSection } from "./FinancialReportSection";
import { LifecycleSection } from "./LifecycleSection";
import { ProjectProgressSection } from "./ProjectProgressSection";

// "Overview" and "Requests" are the two tab labels most likely to be
// mistaken for the *global* sidebar pages of similar names (Impact,
// Activity) — deliberately not reused here even where the content is
// related (Requests groups in Governance Activity, the staff decisions
// that answer those requests), since this page's own scope is one fund,
// not the founder's whole portfolio the way those sidebar pages are.
const TAB_ITEMS = [
  { key: "overview", label: "Overview", icon: IconHome },
  { key: "money", label: "Money", icon: IconClipboardCheck },
  { key: "assets", label: "Assets", icon: IconArchive },
  { key: "requests", label: "Requests", icon: IconInbox },
  { key: "reports", label: "Reports", icon: IconFileText },
] as const;
type TabKey = (typeof TAB_ITEMS)[number]["key"];

// Every group is guaranteed non-empty for every waqf type — Lifecycle/
// ProjectProgress and Investments/Proceeds are the only type-conditional
// sections (Project-only and Investment-only respectively), and
// Contributions/Causes/Distributions/Assets/Beneficiaries/Requests/
// GovernanceActivity/FinancialReport all render for every type. An empty
// first tab was the reason "Overview" carries Contributions (present for
// every type) rather than standing alone as Lifecycle/ProjectProgress,
// which would have left it blank for Asset and Investment funds.
//
// [&>*:first-child]:mt-0/border-t-0/pt-0 below strips the top divider
// every section renders for itself (designed for "stacked in sequence,"
// see e.g. AssetsSection's own wrapper) off of whichever section actually
// lands first inside a given tab panel — which one that is shifts with
// the type-conditional sections above, so this targets it structurally
// rather than hardcoding which component it'll be.
const PANEL_RESET_FIRST_CHILD = "[&>*:first-child]:mt-0 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0";

export default function WaqfFundDetailPage() {
  const params = useParams<{ id: string }>();
  const [waqf, setWaqf] = useState<Waqf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  // A tab's sections only ever mount once it's been opened at least once
  // — the actual fix for the parallel-fetch-on-load problem this
  // redesign exists for — but stay mounted (just CSS-hidden) after that,
  // so flipping back to an already-visited tab doesn't lose state or
  // re-fetch. openedTabs starts with "overview" since that's what's
  // shown immediately, not lazily.
  const [openedTabs, setOpenedTabs] = useState<ReadonlySet<TabKey>>(new Set(["overview"]));

  const selectTab = useCallback((key: string) => {
    const tabKey = key as TabKey;
    setActiveTab(tabKey);
    setOpenedTabs((prev) => (prev.has(tabKey) ? prev : new Set(prev).add(tabKey)));
  }, []);

  const load = useCallback(() => {
    apiFetchJson<Waqf>(`/waqfs/${params.id}`)
      .then((w) => {
        setError(null);
        setWaqf(w);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers waqf.activated and
  // trustee_license.status_changed, both of which link here.
  useMarkNotificationsReadForEntity("Waqf", waqf?.id);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/portfolio" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-primary-700">
        <IconArrowRight className="h-3.5 w-3.5 rotate-180" />
        Portfolio
      </Link>

      {error && (
        <Alert tone="danger" title="Couldn't load this waqf fund" className="mt-2">
          {error}
        </Alert>
      )}

      {!error && !waqf && <DetailSkeleton />}

      {!error && waqf && (
        <>
          <FundHero waqf={waqf} />

          {/* Identity facts stay outside the tabs — always relevant
              regardless of which tab is open. */}
          <Panel className="mb-6">
            <dl className="grid grid-cols-2 divide-slate-100 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
              <Fact label="Type" value={`${humanize(waqf.type)} fund`} />
              <Fact label="Jurisdiction" value={waqf.jurisdiction} />
              <Fact label="Established" value={formatDate(waqf.createdAt)} />
              <Fact label="Funding plan" value={humanize(waqf.fundingPlan)} />
              {/* Deed-signing is Foundation-level, not per-Waqf — see
                  FoundationDeed's own schema comment — so this reads
                  waqf.foundation.foundationDeed, the deed covering this
                  waqf's whole Foundation. Always shown (2026-09-14 audit
                  fix), linking to the page that can actually sign it. */}
              <Fact
                label="Foundation Deed"
                value={
                  <Link
                    href={`/foundations/${waqf.foundationId}/deed`}
                    className={waqf.foundation.foundationDeed ? "text-primary-700 hover:text-primary-800" : "font-semibold text-accent-700 hover:text-accent-800"}
                  >
                    {waqf.foundation.foundationDeed ? `Signed ${formatDate(waqf.foundation.foundationDeed.signedAt)}` : "Not signed — sign now"}
                  </Link>
                }
              />
            </dl>
            {waqf.purpose && (
              <div className="border-t border-slate-100 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Purpose</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{waqf.purpose}</p>
              </div>
            )}
          </Panel>

          <Panel>
            <Tabs items={[...TAB_ITEMS]} active={activeTab} onChange={selectTab} className="px-2 sm:px-4" />
            <div className="p-5 sm:p-6">
            {openedTabs.has("overview") && (
              <div hidden={activeTab !== "overview"} className={PANEL_RESET_FIRST_CHILD}>
                {waqf.type === "project" && <LifecycleSection waqfId={waqf.id} />}
                {waqf.type === "project" && (
                  <ProjectProgressSection waqfId={waqf.id} currency={waqf.corpusCurrency ?? "USD"} />
                )}
                <ContributionsSection waqf={waqf} onCorpusIncreased={load} />
              </div>
            )}

            {openedTabs.has("money") && (
              <div hidden={activeTab !== "money"} className={PANEL_RESET_FIRST_CHILD}>
                <CausesSection
                  waqfId={waqf.id}
                  waqfType={waqf.type}
                  amountRaised={waqf.amountRaised ?? "0"}
                  corpusCurrency={waqf.corpusCurrency}
                />
                {/* Only an Investment-type waqf routes its corpus into an
                    investment venue — every other type goes directly
                    toward its stated purpose (see InvestmentsService
                    .create's own comment, which enforces this
                    server-side too). */}
                {waqf.type === "investment" && <InvestmentsSection waqfId={waqf.id} />}
                {waqf.type === "investment" && <ProceedsSection waqfId={waqf.id} />}
                <DistributionsSection waqfId={waqf.id} />
              </div>
            )}

            {openedTabs.has("assets") && (
              <div hidden={activeTab !== "assets"} className={PANEL_RESET_FIRST_CHILD}>
                <AssetsSection waqfId={waqf.id} />
                <BeneficiariesSection waqfId={waqf.id} />
              </div>
            )}

            {openedTabs.has("requests") && (
              <div hidden={activeTab !== "requests"} className={PANEL_RESET_FIRST_CHILD}>
                <RequestsSection waqfId={waqf.id} waqfType={waqf.type} currency={waqf.corpusCurrency} />
                <GovernanceActivitySection waqfId={waqf.id} />
              </div>
            )}

            {openedTabs.has("reports") && (
              <div hidden={activeTab !== "reports"} className={PANEL_RESET_FIRST_CHILD}>
                <FinancialReportSection waqfId={waqf.id} />
              </div>
            )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

/**
 * The fund's headline: name, where it sits, and what's been raised
 * against its declared corpus (amountRaised — confirmed Contributions in
 * the corpus currency, computed server-side).
 */
function FundHero({ waqf }: { waqf: Waqf }) {
  const StatusIcon = STATUS_ICON[waqf.status];
  const raised = Number(waqf.amountRaised ?? 0);
  const target = waqf.corpusAmount ? Number(waqf.corpusAmount) : null;
  const pct = target ? (raised / target) * 100 : null;
  const canAddFunds = (waqf.status === "active" || waqf.status === "draft") && Boolean(waqf.corpusCurrency);
  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 text-white shadow-lg shadow-primary-950/20">
      <GeometricPattern className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 text-white/[0.06] [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className="relative p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-accent-300 ring-1 ring-inset ring-white/15">
              <StatusIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words font-display text-2xl font-medium tracking-tight sm:text-3xl">{waqf.name}</h1>
                <Badge tone={STATUS_TONE[waqf.status]}>{humanize(waqf.status)}</Badge>
              </div>
              <p className="mt-1 text-sm text-primary-100/80">
                {humanize(waqf.type)} fund · Part of{" "}
                <Link href={`/foundations/${waqf.foundationId}`} className="font-medium text-white underline-offset-2 hover:underline">
                  {waqf.foundation.name}
                </Link>
              </p>
            </div>
          </div>
          {canAddFunds && (
            <Link
              href={`/portfolio/${waqf.id}/top-up`}
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-accent-400 px-4 py-2.5 text-sm font-semibold text-accent-950 shadow-sm transition-colors hover:bg-accent-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
            >
              <IconPlus className="h-4 w-4" />
              Add funds
            </Link>
          )}
        </div>

        {waqf.corpusCurrency && (
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">Raised to date</p>
            <p className="mt-2 font-display text-4xl font-medium tabular-nums tracking-tight">
              {formatMoney(raised, waqf.corpusCurrency, { decimals: 0 })}
            </p>
            {target !== null && pct !== null && (
              <>
                <p className="mt-1.5 text-sm text-primary-100/80">
                  of {formatMoney(target, waqf.corpusCurrency, { decimals: 0 })} declared corpus
                  {raised >= target ? " — fully funded" : ` — ${formatMoney(target - raised, waqf.corpusCurrency, { decimals: 0 })} to go`}
                </p>
                <ProgressBar pct={pct} tone="gold" label={`${Math.round(pct)}% of declared corpus raised`} className="mt-4 max-w-xl" />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading this waqf fund">
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}
