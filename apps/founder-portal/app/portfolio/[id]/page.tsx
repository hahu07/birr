"use client";

// Waqf Fund detail — the full breakdown that used to be crammed into
// the Overview page's cards. Reached from /portfolio; this is also
// where a future breakdown by Cause/Beneficiary/Distribution would
// live once those get their own Founder-facing surfaces.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import { STATUS_BADGE_BG, STATUS_ICON, STATUS_TONE } from "../../../lib/portfolio";
import type { Waqf } from "../../../lib/types";
import { Alert, Badge, Card, DetailGrid, Skeleton } from "@birr/ui";

export default function WaqfFundDetailPage() {
  const params = useParams<{ id: string }>();
  const [waqf, setWaqf] = useState<Waqf | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
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
      <Link href="/portfolio" className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← Portfolio
      </Link>

      {error && (
        <Alert tone="danger" title="Couldn't load this waqf fund" className="mt-6">
          {error}
        </Alert>
      )}

      {!error && !waqf && <DetailSkeleton />}

      {!error && waqf && (
        <>
          <header className="mb-8 mt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3.5">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${STATUS_BADGE_BG[waqf.status]}`}
                >
                  {(() => {
                    const StatusIcon = STATUS_ICON[waqf.status];
                    return <StatusIcon className="h-5 w-5" />;
                  })()}
                </span>
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{waqf.name}</h1>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Part of{" "}
                    <Link href="/portfolio" className="font-medium text-primary-700 hover:text-primary-800">
                      {waqf.foundation.name}
                    </Link>
                  </p>
                </div>
              </div>
              <Badge tone={STATUS_TONE[waqf.status]} className="shrink-0">
                {humanize(waqf.status)}
              </Badge>
            </div>
          </header>

          <Card>
            <DetailGrid
              columns={2}
              items={[
                { label: "Type", value: humanize(waqf.type) },
                { label: "Jurisdiction", value: waqf.jurisdiction },
                { label: "Established", value: formatDate(waqf.createdAt) },
                { label: "Status", value: humanize(waqf.status) },
              ]}
            />
            {waqf.purpose && (
              <div className="mt-5 border-t border-slate-100 pt-5">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Purpose</p>
                <p className="text-sm text-slate-700">{waqf.purpose}</p>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-4">
      <div className="mb-8 flex items-center gap-3.5">
        <Skeleton className="h-11 w-11 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
