"use client";

// Founder-facing, read-only — distribution history aggregated by cause,
// mirroring the same shape Ops Console's own rollup uses (see
// DistributionsSection.tsx there). Deliberately never individual
// distribution rows: beneficiaryCount is a count, not a name, so this
// stays PII-safe the same way BeneficiariesSection does — see
// DistributionsService.summaryByCauseForFounder's own comment. Only
// counts approved distributions (actual payouts), not pending drafts
// still awaiting a Birr officer's maker-checker decision.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import type { DistributionCauseSummary } from "../../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";

export function DistributionsSection({ waqfId }: { waqfId: string }) {
  const [summary, setSummary] = useState<DistributionCauseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<DistributionCauseSummary[]>(`/distributions/summary?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Distributions</p>
      <p className="mb-3 text-sm text-slate-500">What this fund has actually paid out, by cause.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load distribution history">
          {error}
        </Alert>
      )}

      {!error && summary === null && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!error && summary !== null && summary.length === 0 && (
        <p className="text-sm text-slate-500">No approved distributions yet.</p>
      )}

      {!error && summary !== null && summary.length > 0 && (
        <div className="space-y-1.5">
          {summary.map((row) => (
            <div
              key={`${row.causeId}-${row.currency}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <span className="font-medium text-slate-900">{row.causeName}</span>
              <span className="text-slate-500">
                <span className="font-medium text-slate-900">
                  {row.totalAmount} {row.currency}
                </span>{" "}
                across {row.distributionCount} {row.distributionCount === 1 ? "distribution" : "distributions"} to{" "}
                {row.beneficiaryCount} {row.beneficiaryCount === 1 ? "beneficiary" : "beneficiaries"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
