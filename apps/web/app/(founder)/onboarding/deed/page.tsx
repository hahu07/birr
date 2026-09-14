"use client";

// Step 4 — the final onboarding step. The founder's real, structured
// e-signature appointing Birr as Mutawalli (trustee) over the Foundation
// and every Waqf Fund established under it, now or in the future — not
// just the specific fund that happened to get funded first. Deed-
// signing is Foundation-level (see FoundationDeed's own schema
// comment), so nothing about the "+ Add Waqf Fund" flow for a 2nd+ fund
// needs a deed step of its own; this one covers it automatically for the
// founder's first Foundation. The actual form is shared with
// foundations/[id]/deed/page.tsx (see SignFoundationDeedForm's own
// comment on why that page needed it too).
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import type { Foundation } from "../../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";
import { SignFoundationDeedForm } from "../../SignFoundationDeedForm";

export default function OnboardingDeedPage() {
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Foundation[]>("/foundations")
      .then((foundations) => {
        // Exactly one Foundation exists by this point in the wizard.
        if (!cancelled) setFoundation(foundations[0] ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <Link
        href="/onboarding/waqf-fund"
        className="mb-3 inline-flex items-center text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        ← Back
      </Link>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign the waqf deed</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        The last step — formally appointing Birr as Mutawalli (trustee) over your Foundation and every Waqf Fund
        established under it.
      </p>

      {loadError && (
        <Alert tone="danger" title="Couldn't load your foundation" className="mt-6">
          {loadError}
        </Alert>
      )}
      {!loadError && !foundation && <Skeleton className="mt-6 h-40 w-full" />}

      {foundation && (
        <div className="mt-6">
          <SignFoundationDeedForm foundation={foundation} onSigned={() => window.location.reload()} />
        </div>
      )}
    </div>
  );
}
