"use client";

// Waqf Funds list — the entry point into a specific fund's Assets,
// Beneficiaries, Investments, and Distributions (see [id]/page.tsx).
// Read-only, same posture as the Foundations page: establishment is
// donor self-service, this is Birr staff's view of what's been
// established.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { humanize } from "../../lib/format";
import type { Waqf } from "../../lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  IconBriefcase,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const STATUS_TONE: Record<Waqf["status"], "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  suspended: "warning",
  closed: "danger",
};

export default function WaqfsPage() {
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
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <IconBriefcase className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Waqf Funds</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Every fund established by a Founder — open one to see its assets, beneficiaries, investments, and
            distributions.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load waqf funds" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && waqfs === null && <WaqfsSkeleton />}

      {!error && waqfs !== null && waqfs.length === 0 && (
        <EmptyState title="No waqf funds yet" description="Funds established by Founders will appear here." />
      )}

      {!error && waqfs !== null && waqfs.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Foundation</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Jurisdiction</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {waqfs.map((waqf) => (
              <TableRow key={waqf.id}>
                <TableCell>
                  <Link href={`/waqfs/${waqf.id}`} className="font-medium text-primary-700 hover:text-primary-800">
                    {waqf.name}
                  </Link>
                </TableCell>
                <TableCell className="text-slate-500">{waqf.foundation.name}</TableCell>
                <TableCell>{humanize(waqf.type)}</TableCell>
                <TableCell>{waqf.jurisdiction}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[waqf.status]}>{humanize(waqf.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function WaqfsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
