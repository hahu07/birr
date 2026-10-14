"use client";

// Thin wrapper around the shared WaqfFundForm's existingWaqf ("skip
// fund creation, just pay") mode — the actual top-up entry point linked
// from ContributionsSection on the waqf detail page.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import type { Waqf } from "../../../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";
import { WaqfFundForm } from "../../../foundations/[id]/waqf-funds/new/WaqfFundForm";
import { PageHeader } from "../../../_components/ui";

export default function TopUpPage() {
  const params = useParams<{ id: string }>();
  const [waqf, setWaqf] = useState<Waqf | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Waqf>(`/waqfs/${params.id}`)
      .then((data) => {
        if (!cancelled) setWaqf(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ href: `/portfolio/${params.id}`, label: waqf?.name ?? "Back to fund" }}
        eyebrow="Add funds"
        title={waqf ? waqf.name : "Add funds"}
        description="Dedicate more toward this waqf fund's corpus — it's added once the payment is confirmed."
      />

      {error && (
        <Alert tone="danger" title="Couldn't load this waqf fund" className="mt-6">
          {error}
        </Alert>
      )}

      {!error && !waqf && (
        <div className="space-y-3">
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      )}

      {!error && waqf && (
        <div>
          <WaqfFundForm
            foundationId={waqf.foundationId}
            existingWaqf={{
              id: waqf.id,
              name: waqf.name,
              corpusAmount: waqf.corpusAmount,
              corpusCurrency: waqf.corpusCurrency,
              fundingPlan: waqf.fundingPlan,
              amountRaised: waqf.amountRaised,
            }}
            cancelHref={`/portfolio/${waqf.id}`}
          />
        </div>
      )}
    </div>
  );
}
