"use client";

// Establish a Waqf Fund under one of the founder's own Foundations —
// self-service (POST /waqfs), plus declaring and actually paying in the
// amount being dedicated (POST /contributions, real payment processing
// across three rails). Unlike the removed Ops Console equivalent,
// there's no maker-checker language here: creating the fund IS how the
// donor agrees Birr becomes Mutawalli over it, not a proposal awaiting
// a Birr officer's decision. The fund itself is created immediately in
// `draft` — it only flips to `active` once the contribution actually
// confirms (see the /contributions/[id] polling page this redirects to).
// This page is for post-onboarding use (2nd+ Waqf Fund) — the onboarding
// wizard's step 3 renders WaqfFundForm directly (see
// app/onboarding/waqf-fund/page.tsx).
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import type { Foundation } from "../../../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";
import { WaqfFundForm } from "./WaqfFundForm";

export default function NewWaqfFundPage() {
  const params = useParams<{ id: string }>();
  const foundationId = params.id;

  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Foundation>(`/foundations/${foundationId}`)
      .then((data) => {
        if (!cancelled) setFoundation(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [foundationId]);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <Link href="/portfolio" className="text-sm font-medium text-primary-700 hover:text-primary-800">
          ← Portfolio
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Establish a Waqf Fund</h1>
        {loadError && (
          <Alert tone="danger" title="Couldn't load the foundation" className="mt-4">
            {loadError}
          </Alert>
        )}
        {!loadError && !foundation && <Skeleton className="mt-1 h-4 w-64" />}
        {foundation && (
          <p className="mt-0.5 text-sm text-slate-500">
            Under <span className="font-medium text-slate-700">{foundation.name}</span>. This takes effect
            immediately — Birr becomes Mutawalli (trustee) over it as soon as it's created.
          </p>
        )}
      </header>

      <WaqfFundForm foundationId={foundationId} cancelHref="/portfolio" />
    </div>
  );
}
