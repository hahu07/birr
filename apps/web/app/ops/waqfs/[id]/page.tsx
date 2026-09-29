"use client";

// Waqf Fund detail — the working view for a specific fund's registered
// Assets, Causes, Beneficiaries, Investments, and Distributions.
// Registration (this page) is plain CRUD for all of these — disposal,
// criteria changes, investment changes, and distribution approval are
// always governed_actions: each section proposes via the shared
// ProposeGovernedActionButton (or a small bespoke inline component when
// the action needs a value, e.g. a new allocated amount), and every
// decision itself happens on the Approval Queue page, never here.
//
// 2026-09-29 redesign — same tabbed treatment as the Founder Portal's own
// equivalent page (apps/web/app/(founder)/portfolio/[id]/page.tsx), for
// the identical reason: sixteen sections in one continuous space-y-10
// scroll, every one fetching on mount regardless of whether anyone was
// looking at it. Grouped into four tabs by staff intent rather than
// entity — where things stand, the money, what's held/who's helped, and
// reporting. Every section component below is unchanged; only which
// ones mount, and when, changed. The cross-section version counters
// (causesVersion etc.) still work exactly as before: a mounted-but-
// hidden section's own effects still fire on a prop change, and a tab
// opened for the first time mounts fresh with whatever the current
// version values already are — see selectTab's own comment.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize, formatDate } from "../../../../lib/format";
import { useMarkNotificationsReadForEntity } from "../../../../lib/notifications";
import type { Waqf, WaqfMilestone } from "../../../../lib/ops-types";
import { Alert, Badge, IconArchive, IconBriefcase, IconClipboardCheck, IconFileText, IconHome, Skeleton, Tabs } from "@birr/ui";
import { LicenseStatusBanner } from "./LicenseStatusBanner";
import { CaseAssignmentsSection } from "./CaseAssignmentsSection";
import { LifecycleSection } from "./LifecycleSection";
import { ContributionsSection } from "./ContributionsSection";
import { CausesSection } from "./CausesSection";
import { CauseImpactSection } from "./CauseImpactSection";
import { AssetsSection } from "./AssetsSection";
import { BeneficiariesSection } from "./BeneficiariesSection";
import { InvestmentsSection } from "./InvestmentsSection";
import { InvestmentTargetsSection } from "./InvestmentTargetsSection";
import { ProceedsSection } from "./ProceedsSection";
import { DistributionsSection } from "./DistributionsSection";
import { ComplianceReportSection } from "./ComplianceReportSection";
import { FinancialReportSection } from "./FinancialReportSection";
import { WaqfMilestonesSection } from "./WaqfMilestonesSection";
import { WaqfExpensesSection } from "./WaqfExpensesSection";
import { WaqfLedgerSection } from "./WaqfLedgerSection";
import { useLoadedResource } from "../../_components/SectionChrome";

const STATUS_TONE: Record<Waqf["status"], "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  suspended: "warning",
  dissolved: "danger",
};

// No "Requests" tab here the way the Founder Portal's own page has one —
// that tab is a founder *asking* Birr for something; Founder Requests is
// its own top-level Ops Console queue (app/ops/founder-requests), not a
// per-fund section on this page at all. Every group below is non-empty
// for every waqf type — Lifecycle/WaqfMilestones (Project-only) and
// Investments/InvestmentTargets/Proceeds/WaqfExpenses (Investment- or
// Project-only) are the only type-conditional sections; everything else
// renders for every type.
const TAB_ITEMS = [
  { key: "overview", label: "Overview", icon: IconHome },
  { key: "money", label: "Money", icon: IconClipboardCheck },
  { key: "assets", label: "Assets & Impact", icon: IconArchive },
  { key: "reports", label: "Reports", icon: IconFileText },
] as const;
type TabKey = (typeof TAB_ITEMS)[number]["key"];

export default function WaqfDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [waqf, setWaqf] = useState<Waqf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  // A tab's sections only mount once it's been opened at least once —
  // the actual fix for the parallel-fetch-on-load problem this redesign
  // exists for — then stay mounted (CSS-hidden) so flipping back doesn't
  // lose state or re-fetch. "overview" starts opened since it's shown
  // immediately, not lazily. See the Founder Portal page's own identical
  // comment on this pattern.
  const [openedTabs, setOpenedTabs] = useState<ReadonlySet<TabKey>>(new Set(["overview"]));

  const selectTab = useCallback((key: string) => {
    const tabKey = key as TabKey;
    setActiveTab(tabKey);
    setOpenedTabs((prev) => (prev.has(tabKey) ? prev : new Set(prev).add(tabKey)));
  }, []);

  // Bumped by CausesSection/BeneficiariesSection whenever they create a
  // row — Distributions (and Beneficiaries, for causes) need to refetch
  // their own pickers when a sibling section adds something they
  // reference, since each section otherwise only fetches on mount.
  const [causesVersion, setCausesVersion] = useState(0);
  const [beneficiariesVersion, setBeneficiariesVersion] = useState(0);
  // Bumped by ProceedsSection whenever it records a new proceeds entry
  // — the backend auto-reallocates proceeds across causes proportionally
  // on every record() now, so CausesSection needs to refetch to show
  // each cause's freshly recomputed proceedsAllocatedAmount.
  const [proceedsVersion, setProceedsVersion] = useState(0);
  // Bumped by WaqfExpensesSection whenever it records an expense — the
  // journal entry it auto-posts is exactly what WaqfLedgerSection's own
  // reports read, so those need to refetch too, not just Milestones.
  const [ledgerVersion, setLedgerVersion] = useState(0);

  const load = useCallback(() => {
    apiFetchJson<Waqf>(`/waqfs/${id}`)
      .then(setWaqf)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Project-type waqfs only (WaqfMilestonesService itself rejects
  // creation against anything else) — the single shared fetch every
  // section that touches milestones reads from (WaqfMilestonesSection's
  // own display, WaqfExpensesSection's and DistributionsSection's
  // milestone-link dropdowns), needed across more than one tab, so it
  // deliberately stays page-level and unconditional rather than gated
  // behind any tab's own opened-state the way each section's individual
  // fetch is. Hooks run unconditionally before the early error/loading
  // returns below, so `waqf` may still be null on the first render — the
  // fetcher itself guards against that rather than skipping the hook call.
  const {
    data: milestones,
    error: milestonesError,
    reload: reloadMilestones,
  } = useLoadedResource(
    () => (waqf?.type === "project" ? apiFetchJson<WaqfMilestone[]>(`/waqf-milestones?waqfId=${id}`) : Promise.resolve([])),
    [id, waqf?.type],
  );

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers
  // waqf.needs_case_assignment, which links here.
  useMarkNotificationsReadForEntity("Waqf", id);

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this waqf fund">
        {error}
      </Alert>
    );
  }

  if (!waqf) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  return (
    <div>
      <header className="mb-8">
        <Link href="/ops/waqfs" className="text-sm text-slate-500 hover:text-primary-700">
          ← Waqf Funds
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconBriefcase className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{waqf.name}</h1>
              <Badge tone={STATUS_TONE[waqf.status]}>{humanize(waqf.status)}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {humanize(waqf.type)} · {waqf.jurisdiction} · Part of{" "}
              <span className="font-medium text-slate-700">{waqf.foundation.name}</span>
              {/* Deed-signing is Foundation-level, not per-Waqf — see
                  FoundationDeed's own schema comment. */}
              {waqf.foundation.foundationDeed && <> · Deed signed {formatDate(waqf.foundation.foundationDeed.signedAt)}</>}
            </p>
            {waqf.corpusAmount && (
              <p className="mt-0.5 text-sm text-slate-500">
                {humanize(waqf.fundingPlan)} corpus of {waqf.corpusCurrency} {formatAmount(waqf.corpusAmount)} —{" "}
                {waqf.corpusCurrency} {formatAmount(waqf.amountRaised ?? "0")} raised
              </p>
            )}
          </div>
        </div>
      </header>

      <LicenseStatusBanner status={waqf.trusteeLicenseStatus} jurisdiction={waqf.jurisdiction} />

      <Tabs items={[...TAB_ITEMS]} active={activeTab} onChange={selectTab} className="mb-8" />

      {openedTabs.has("overview") && (
        <div hidden={activeTab !== "overview"} className="space-y-10">
          <CaseAssignmentsSection waqfId={id} />
          {waqf.type === "project" && <LifecycleSection waqfId={id} />}
          {waqf.type === "project" && (
            <WaqfMilestonesSection
              waqfId={id}
              currency={waqf.corpusCurrency ?? "USD"}
              milestones={milestones}
              error={milestonesError}
              onChanged={reloadMilestones}
            />
          )}
          <ContributionsSection waqfId={id} />
        </div>
      )}

      {openedTabs.has("money") && (
        <div hidden={activeTab !== "money"} className="space-y-10">
          <CausesSection
            waqfId={id}
            waqfType={waqf.type}
            corpusCurrency={waqf.corpusCurrency}
            onChanged={() => setCausesVersion((v) => v + 1)}
            proceedsVersion={proceedsVersion}
          />
          {/* Only an Investment-type waqf routes its corpus into an
              investment venue at all — every other type goes directly
              toward its stated purpose (see InvestmentsService.create's
              own comment, which enforces this server-side too). */}
          {waqf.type === "investment" && (
            <>
              <InvestmentsSection waqfId={id} amountRaised={waqf.amountRaised ?? "0"} corpusCurrency={waqf.corpusCurrency} />
              <InvestmentTargetsSection waqfId={id} />
              <ProceedsSection waqfId={id} onChanged={() => setProceedsVersion((v) => v + 1)} />
            </>
          )}
          {waqf.type === "project" && (
            <WaqfExpensesSection
              waqfId={id}
              currency={waqf.corpusCurrency ?? "USD"}
              milestones={milestones ?? []}
              onChanged={() => {
                reloadMilestones();
                setLedgerVersion((v) => v + 1);
              }}
            />
          )}
          <DistributionsSection
            waqfId={id}
            causesVersion={causesVersion}
            beneficiariesVersion={beneficiariesVersion}
            milestones={milestones ?? []}
          />
        </div>
      )}

      {openedTabs.has("assets") && (
        <div hidden={activeTab !== "assets"} className="space-y-10">
          <AssetsSection waqfId={id} />
          <BeneficiariesSection
            waqfId={id}
            causesVersion={causesVersion}
            onChanged={() => setBeneficiariesVersion((v) => v + 1)}
          />
          <CauseImpactSection waqfId={id} causesVersion={causesVersion} />
        </div>
      )}

      {openedTabs.has("reports") && (
        <div hidden={activeTab !== "reports"} className="space-y-10">
          <FinancialReportSection waqfId={id} />
          <ComplianceReportSection waqfId={id} />
          <WaqfLedgerSection waqfId={id} currency={waqf.corpusCurrency ?? "USD"} refreshKey={ledgerVersion} />
        </div>
      )}
    </div>
  );
}
