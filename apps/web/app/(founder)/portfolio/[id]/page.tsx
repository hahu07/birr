"use client";

// Waqf Fund detail — the full breakdown that used to be crammed into
// the Overview page's cards. Reached from /portfolio. Causes, Assets,
// Investments, Distributions, Beneficiaries, and Governance Activity
// each have their own Founder-facing surface below — all read-only
// (registration/disposal/approval stay Birr-staff-mediated), and
// Beneficiaries/Distributions are aggregates rather than individual rows
// (see those components' own comments on why beneficiary identity never
// crosses into this portal).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, humanize } from "../../../../lib/format";
import { STATUS_BADGE_BG, STATUS_ICON, STATUS_TONE } from "../../../../lib/portfolio";
import { useMarkNotificationsReadForEntity } from "../../../../lib/notifications";
import type { Waqf } from "../../../../lib/types";
import { Alert, Badge, Card, DetailGrid, Skeleton } from "@birr/ui";
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

export default function WaqfFundDetailPage() {
  const params = useParams<{ id: string }>();
  const [waqf, setWaqf] = useState<Waqf | null>(null);
  const [error, setError] = useState<string | null>(null);

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

          <Card>
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

            {waqf.type === "project" && <LifecycleSection waqfId={waqf.id} />}
            {waqf.type === "project" && (
              <ProjectProgressSection waqfId={waqf.id} currency={waqf.corpusCurrency ?? "USD"} />
            )}
            <ContributionsSection waqf={waqf} onCorpusIncreased={load} />
            <CausesSection
              waqfId={waqf.id}
              waqfType={waqf.type}
              amountRaised={waqf.amountRaised ?? "0"}
              corpusCurrency={waqf.corpusCurrency}
            />
            <AssetsSection waqfId={waqf.id} />
            {/* Only an Investment-type waqf routes its corpus into an
                investment venue — every other type goes directly toward
                its stated purpose (see InvestmentsService.create's own
                comment, which enforces this server-side too). */}
            {waqf.type === "investment" && <InvestmentsSection waqfId={waqf.id} />}
            {waqf.type === "investment" && <ProceedsSection waqfId={waqf.id} />}
            <DistributionsSection waqfId={waqf.id} />
            <BeneficiariesSection waqfId={waqf.id} />
            <RequestsSection waqfId={waqf.id} waqfType={waqf.type} />
            <GovernanceActivitySection waqfId={waqf.id} />
            <FinancialReportSection waqfId={waqf.id} />
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
