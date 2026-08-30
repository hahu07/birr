"use client";

// Step 3 — establish the first Waqf Fund and pay the first contribution.
// Checks for an already-existing-but-unfunded Waqf first (the retry path
// after a previous failed/abandoned payment attempt) so a second attempt
// re-POSTs /contributions against the same waqfId instead of creating a
// duplicate Waqf — WaqfFundForm's existingWaqf prop handles this.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize } from "../../../../lib/format";
import { ROUTE_FOR_STEP } from "../../../../lib/onboarding";
import type { Foundation, Waqf } from "../../../../lib/types";
import { Alert, Badge, Skeleton } from "@birr/ui";
import { WaqfFundForm } from "../../foundations/[id]/waqf-funds/new/WaqfFundForm";

export default function OnboardingWaqfFundPage() {
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [existingWaqf, setExistingWaqf] = useState<Waqf | null | undefined>(undefined);
  // Set only when every waqf here is already past draft — a founder can
  // reach this route after step 3 is already done (clicking "Back" from
  // step 4, a bookmark, or — per app-shell's own onboarding gate —
  // simply revisiting an earlier-completed step's URL is deliberately
  // allowed, not bounced forward automatically). Rendering the blank
  // "create a new one" form in that case would be wrong (and could let
  // a founder accidentally create a second Waqf Fund from what's
  // supposed to be a one-time onboarding step) — but silently
  // redirecting forward would make "Back" a dead end, which defeats the
  // whole point of it existing. Show a summary instead and let the
  // founder choose to continue.
  const [completedWaqfs, setCompletedWaqfs] = useState<Waqf[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetchJson<Foundation[]>("/foundations"), apiFetchJson<Waqf[]>("/waqfs")])
      .then(([foundations, waqfs]) => {
        if (cancelled) return;
        if (waqfs.length > 0 && !waqfs.some((w) => w.status === "draft")) {
          setCompletedWaqfs(waqfs);
          return;
        }
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

  const loading = !loadError && !completedWaqfs && (foundation === null || existingWaqf === undefined);

  return (
    <div>
      <Link
        href="/onboarding/founder-foundation"
        className="mb-3 inline-flex items-center text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        ← Back
      </Link>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {completedWaqfs ? "Your Waqf Fund is established" : existingWaqf ? "Complete your first contribution" : "Establish your first Waqf Fund"}
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

      {completedWaqfs && (
        <div className="mt-6 space-y-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Already funded</p>
          {completedWaqfs.map((w) => (
            <div key={w.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{w.name}</p>
                <Badge tone="success">{humanize(w.status)}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {humanize(w.type)} · {w.jurisdiction}
                {w.purpose ? ` · ${w.purpose}` : ""}
              </p>
              {w.corpusAmount && (
                <p className="mt-1.5 text-sm text-slate-600">
                  {humanize(w.fundingPlan)} corpus of {w.corpusCurrency} {formatAmount(w.corpusAmount)}
                </p>
              )}
            </div>
          ))}
          <Link
            href={ROUTE_FOR_STEP[4]}
            className="inline-flex items-center text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            Continue to sign deed →
          </Link>
        </div>
      )}

      {!loading && !completedWaqfs && foundation && (
        <div className="mt-6">
          <WaqfFundForm foundationId={foundation.id} existingWaqf={existingWaqf ?? undefined} />
        </div>
      )}
    </div>
  );
}
