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
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, humanize } from "../../../../lib/format";
import { STATUS_BADGE_BG, STATUS_ICON, STATUS_TONE } from "../../../../lib/portfolio";
import { useMarkNotificationsReadForEntity } from "../../../../lib/notifications";
import type { Waqf } from "../../../../lib/types";
import {
  Alert,
  Badge,
  Card,
  DetailGrid,
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
      .then(setWaqf)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [params.id]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers waqf.activated and
  // trustee_license.status_changed, both of which link here.
  useMarkNotificationsReadForEntity("Waqf", waqf?.id);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/portfolio" className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← Portfolio
      </Link>

      {error && (
        <Alert tone="danger" title="Couldn't load this waqf fund" className="mt-6">
          {error}
        </Alert>
      )}

      {!error && !waqf && <DetailSkeleton />}

      {!error && waqf && (
        <>
          <header className="mb-8 mt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3.5">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${STATUS_BADGE_BG[waqf.status]}`}
                >
                  {(() => {
                    const StatusIcon = STATUS_ICON[waqf.status];
                    return <StatusIcon className="h-5 w-5" />;
                  })()}
                </span>
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{waqf.name}</h1>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Part of{" "}
                    <Link href="/portfolio" className="font-medium text-primary-700 hover:text-primary-800">
                      {waqf.foundation.name}
                    </Link>
                  </p>
                </div>
              </div>
              <Badge tone={STATUS_TONE[waqf.status]} className="shrink-0">
                {humanize(waqf.status)}
              </Badge>
            </div>
          </header>

          {/* Identity info stays outside the tabs — always relevant
              regardless of which tab is open, same reasoning the header
              above already follows. */}
          <Card className="mb-6">
            <DetailGrid
              columns={2}
              items={[
                { label: "Type", value: humanize(waqf.type) },
                { label: "Jurisdiction", value: waqf.jurisdiction },
                { label: "Established", value: formatDate(waqf.createdAt) },
                { label: "Status", value: humanize(waqf.status) },
                // Deed-signing is Foundation-level, not per-Waqf — see
                // FoundationDeed's own schema comment — so this reads
                // waqf.foundation.foundationDeed, the deed covering this
                // waqf's whole Foundation, not a per-fund one. 2026-09-14
                // audit fix: this row used to be omitted entirely when
                // unsigned, so a founder viewing a fund under an unsigned
                // 2nd+ Foundation had no clue signing was even possible
                // from here — now always shown, linking to the page that
                // can actually sign it (foundations/[id]/deed).
                {
                  label: "Deed",
                  value: waqf.foundation.foundationDeed ? (
                    <Link href={`/foundations/${waqf.foundationId}/deed`} className="text-primary-700 hover:text-primary-800">
                      Signed {formatDate(waqf.foundation.foundationDeed.signedAt)} — View →
                    </Link>
                  ) : (
                    <Link href={`/foundations/${waqf.foundationId}/deed`} className="text-primary-700 hover:text-primary-800">
                      Not signed yet — Sign →
                    </Link>
                  ),
                },
              ]}
            />
            {waqf.purpose && (
              <div className="mt-5 border-t border-slate-100 pt-5">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Purpose</p>
                <p className="text-sm text-slate-700">{waqf.purpose}</p>
              </div>
            )}
          </Card>

          <Tabs items={[...TAB_ITEMS]} active={activeTab} onChange={selectTab} className="mb-0" />

          <Card className="rounded-t-none border-t-0">
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
          </Card>
        </>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-4">
      <div className="mb-8 flex items-center gap-3.5">
        <Skeleton className="h-11 w-11 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
