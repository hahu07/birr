"use client";

// CLAUDE.md's 13 waqf lifecycle stages, read-only — see
// WaqfsService.getLifecycleStatus's own comment for how each stage is
// derived (purely computed, never persisted). Only rendered for
// Project-type Waqf Funds (see this waqf's own page.tsx) — the backend
// route works for any type, but the user asked specifically to track
// this for Project funds; extending display to other types later is a
// one-line change there, none here.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, humanize } from "../../../../lib/format";
import type { WaqfLifecycleStatus } from "../../../../lib/ops-types";
import { Alert, LifecycleChecklist, Skeleton } from "@birr/ui";
import type { LifecycleChecklistRow } from "@birr/ui";

function buildRows(status: WaqfLifecycleStatus): LifecycleChecklistRow[] {
  const { stages } = status;

  return [
    { key: "establishment", label: "Establishment", status: stages.establishment.status, detail: formatDate(stages.establishment.completedAt!) },
    {
      key: "legalDocumentation",
      label: "Legal documentation",
      status: stages.legalDocumentation.status,
      detail: stages.legalDocumentation.signedAt ? `Signed ${formatDate(stages.legalDocumentation.signedAt)}` : null,
    },
    {
      key: "assetRegistration",
      label: "Asset registration",
      status: stages.assetRegistration.status,
      detail: stages.assetRegistration.count ? `${stages.assetRegistration.count} asset(s)` : null,
    },
    {
      key: "governanceConfiguration",
      label: "Governance configuration",
      status: stages.governanceConfiguration.status,
      detail: stages.governanceConfiguration.assignmentRoles?.length
        ? stages.governanceConfiguration.assignmentRoles.map(humanize).join(", ")
        : null,
    },
    {
      key: "investmentManagement",
      label: "Investment management",
      status: stages.investmentManagement.status,
      detail:
        stages.investmentManagement.status === "not_applicable"
          ? "Not applicable to this fund type"
          : stages.investmentManagement.count
            ? `${stages.investmentManagement.count} investment(s)`
            : null,
    },
    {
      key: "beneficiaryAdministration",
      label: "Beneficiary administration",
      status: stages.beneficiaryAdministration.status,
      detail: stages.beneficiaryAdministration.count ? `${stages.beneficiaryAdministration.count} beneficiary(ies)` : null,
    },
    {
      key: "distributionManagement",
      label: "Distribution management",
      status: stages.distributionManagement.status,
      detail: stages.distributionManagement.count ? `${stages.distributionManagement.count} distribution(s) paid` : null,
    },
    {
      key: "complianceMonitoring",
      label: "Compliance monitoring",
      status: stages.complianceMonitoring.status,
      detail: stages.complianceMonitoring.frameworkName,
    },
    {
      key: "financialReporting",
      label: "Financial reporting",
      status: stages.financialReporting.status,
      detail: stages.financialReporting.count
        ? `${stages.financialReporting.count} report(s) generated`
        : null,
    },
    {
      key: "impactMeasurement",
      label: "Impact measurement",
      status: stages.impactMeasurement.status,
      detail: stages.impactMeasurement.count ? `${stages.impactMeasurement.count} update(s)` : null,
    },
    {
      key: "audit",
      label: "Audit",
      status: stages.audit.status,
      detail: stages.audit.count ? `${stages.audit.count} audit log ${stages.audit.count === 1 ? "entry" : "entries"}` : null,
    },
    { key: "successionManagement", label: "Succession management", status: stages.successionManagement.status, detail: "Not yet available" },
    {
      key: "longTermPreservation",
      label: "Long-term preservation",
      status: stages.longTermPreservation.status,
      detail: "Guaranteed by the immutable audit trail",
    },
  ];
}

export function LifecycleSection({ waqfId }: { waqfId: string }) {
  const [status, setStatus] = useState<WaqfLifecycleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<WaqfLifecycleStatus>(`/waqfs/${waqfId}/lifecycle`)
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  return (
    <section>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Lifecycle</p>
      <p className="mb-3 text-sm text-slate-500">Where this fund stands across every governance and administration stage.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load lifecycle status" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && status === null && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {!error && status !== null && (
        <LifecycleChecklist rows={buildRows(status)} completedCount={status.completedCount} trackableCount={status.trackableCount} />
      )}
    </section>
  );
}
