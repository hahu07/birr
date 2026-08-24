"use client";

// Step 3 — establish the first Waqf Fund and pay the first contribution.
// Checks for an already-existing-but-unfunded Waqf first (the retry path
// after a previous failed/abandoned payment attempt) so a second attempt
// re-POSTs /contributions against the same waqfId instead of creating a
// duplicate Waqf — WaqfFundForm's existingWaqf prop handles this.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import type { Foundation, Waqf } from "../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";
import { WaqfFundForm } from "../../foundations/[id]/waqf-funds/new/WaqfFundForm";

export default function OnboardingWaqfFundPage() {
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [existingWaqf, setExistingWaqf] = useState<Waqf | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetchJson<Foundation[]>("/foundations"), apiFetchJson<Waqf[]>("/waqfs")])
      .then(([foundations, waqfs]) => {
        if (cancelled) return;
        // Exactly one Foundation exists by this point in the wizard.
        setFoundation(foundations[0] ?? null);
        setExistingWaqf(waqfs.find((w) => w.status === "draft") ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !loadError && (foundation === null || existingWaqf === undefined);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {existingWaqf ? "Complete your first contribution" : "Establish your first Waqf Fund"}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        This takes effect immediately — Birr becomes Mutawalli (trustee) over it as soon as it's funded.
      </p>

      {loadError && (
        <Alert tone="danger" title="Couldn't load your foundation" className="mt-6">
          {loadError}
        </Alert>
      )}

      {loading && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!loading && foundation && (
        <div className="mt-6">
          <WaqfFundForm foundationId={foundation.id} existingWaqf={existingWaqf ?? undefined} />
        </div>
      )}
    </div>
  );
}
