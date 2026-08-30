"use client";

// The signed waqf deed — the actual legal instrument appointing Birr as
// Mutawalli (trustee), viewable any time after signing, not just once
// during the onboarding wizard's step 4 (which showed a summary, never
// deedText itself). Fetched via GET /waqfs/:id, already founder-scoped
// (see WaqfsService.findByIdForFounder) — no separate deed endpoint
// needed here.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import { formatDate } from "../../../../../lib/format";
import type { Waqf } from "../../../../../lib/types";
import { Alert, Button, Card, Skeleton } from "@birr/ui";

export default function WaqfDeedPage() {
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
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/portfolio/${params.id}`}
          className="text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          ← {waqf?.name ?? "Waqf Fund"}
        </Link>
        {waqf?.waqfDeed && (
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't load this deed" className="mt-6">
          {error}
        </Alert>
      )}

      {!error && !waqf && <Skeleton className="mt-6 h-96 w-full" />}

      {!error && waqf && !waqf.waqfDeed && (
        <Alert tone="warning" title="No deed signed yet" className="mt-6">
          {waqf.name} doesn&apos;t have a signed deed on file yet.
        </Alert>
      )}

      {!error && waqf?.waqfDeed && (
        <Card className="mt-6">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Deed of Waqf</p>
          <h1 className="mb-4 text-lg font-semibold text-slate-900">{waqf.name}</h1>

          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
            {waqf.waqfDeed.deedText}
          </pre>

          <div className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-500">
            <p>
              Signed by <span className="font-medium text-slate-700">{waqf.waqfDeed.typedLegalName}</span> on{" "}
              {formatDate(waqf.waqfDeed.signedAt)}.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
