"use client";

// Portfolio — the actual Foundation/Waqf Fund breakdown (moved off the
// Overview page, which is a summary, not a working list). Each Waqf
// Fund card here is a lightweight summary; its full breakdown lives on
// /portfolio/[id]. Establishment (new Foundation, new Waqf Fund) is
// donor self-service, immediate, no approval gate.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetchJson } from "../../lib/api";
import { humanize } from "../../lib/format";
import { groupByFoundation, STATUS_BADGE_BG, STATUS_ICON, STATUS_TONE } from "../../lib/portfolio";
import type { Waqf } from "../../lib/types";
import { Alert, Badge, Button, Card, EmptyState, IconBriefcase, Skeleton } from "@birr/ui";

export default function PortfolioPage() {
  const router = useRouter();
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Waqf[]>("/waqfs")
      .then((data) => {
        if (!cancelled) setWaqfs(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <IconBriefcase className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Portfolio</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Every Foundation and Waqf Fund established under your account.
            </p>
          </div>
        </div>
        <Link href="/foundations/new">
          <Button variant="secondary">+ Foundation</Button>
        </Link>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load your portfolio" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && waqfs === null && <PortfolioSkeleton />}

      {!error && waqfs !== null && waqfs.length === 0 && (
        <EmptyState
          title="No waqf yet"
          description="Establish a Foundation to get started — you can add Waqf Funds under it right away."
          action={
            <Link href="/foundations/new">
              <Button variant="primary">Establish a Foundation</Button>
            </Link>
          }
        />
      )}

      {!error && waqfs !== null && waqfs.length > 0 && (
        <div className="space-y-10">
          {groupByFoundation(waqfs).map(({ foundation, waqfs: foundationWaqfs }) => (
            <section key={foundation.id}>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{foundation.name}</h2>
                  {(foundation.purpose || foundation.jurisdiction) && (
                    <p className="mt-0.5 text-sm text-slate-500">
                      {[foundation.purpose, foundation.jurisdiction].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <Link
                  href={`/foundations/${foundation.id}/waqf-funds/new`}
                  className="shrink-0 text-sm font-medium text-primary-700 hover:text-primary-800"
                >
                  + Add Waqf Fund
                </Link>
              </div>
              <div className="space-y-3">
                {foundationWaqfs.map((waqf) => {
                  const StatusIcon = STATUS_ICON[waqf.status];
                  return (
                    <Card
                      key={waqf.id}
                      className="cursor-pointer p-0 transition-shadow hover:shadow-md"
                      onClick={() => router.push(`/portfolio/${waqf.id}`)}
                    >
                      <div className="flex items-center justify-between gap-4 px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3.5">
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${STATUS_BADGE_BG[waqf.status]}`}
                          >
                            <StatusIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-primary-800">{waqf.name}</p>
                            <p className="text-xs text-slate-500">{humanize(waqf.type)}</p>
                          </div>
                        </div>
                        <Badge tone={STATUS_TONE[waqf.status]} className="shrink-0">
                          {humanize(waqf.status)}
                        </Badge>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-5">
      {[0, 1].map((i) => (
        <div key={i}>
          <Skeleton className="mb-3 h-4 w-48" />
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {[0, 1].map((j) => (
                <div key={j} className="flex items-center gap-3.5 px-5 py-4">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
