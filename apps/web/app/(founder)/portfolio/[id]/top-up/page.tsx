"use client";

// Thin wrapper around the shared WaqfFundForm's existingWaqf ("skip
// fund creation, just pay") mode — the actual top-up entry point linked
// from ContributionsSection on the waqf detail page.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import type { Waqf } from "../../../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";
import { WaqfFundForm } from "../../../foundations/[id]/waqf-funds/new/WaqfFundForm";

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
      <Link href={`/portfolio/${params.id}`} className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← Back
      </Link>

      <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Add funds</h1>
      <p className="mt-1.5 text-sm text-slate-500">Dedicate more toward this waqf fund's corpus.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load this waqf fund" className="mt-6">
          {error}
        </Alert>
      )}

      {!error && !waqf && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!error && waqf && (
        <div className="mt-6">
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
