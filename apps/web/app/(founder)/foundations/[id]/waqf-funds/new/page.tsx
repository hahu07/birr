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
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../../../lib/api";
import type { Foundation } from "../../../../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";
import { WaqfFundForm } from "./WaqfFundForm";
import { PageHeader } from "../../../../_components/ui";

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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        back={{ href: foundation ? `/foundations/${foundationId}` : "/portfolio", label: foundation ? foundation.name : "Portfolio" }}
        eyebrow="New Waqf Fund"
        title="Establish a Waqf Fund"
        description={
          foundation ? (
            <>
              Under <span className="font-medium text-slate-800">{foundation.name}</span>. This takes effect immediately —
              Birr becomes Mutawalli (trustee) over it as soon as it's created.
            </>
          ) : undefined
        }
      />
      {loadError && (
        <Alert tone="danger" title="Couldn't load the foundation" className="mb-6">
          {loadError}
        </Alert>
      )}
      {!loadError && !foundation && <Skeleton className="-mt-4 mb-8 h-4 w-64" />}

      <WaqfFundForm foundationId={foundationId} cancelHref="/portfolio" />
    </div>
  );
}
