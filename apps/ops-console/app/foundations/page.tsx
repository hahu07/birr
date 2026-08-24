"use client";

// Foundations list — read-only staff visibility into Foundation/Waqf
// Fund establishment activity. Both are donor self-service now (see
// apps/founder-portal/app/foundations/), not something Birr staff
// create on a Founder's behalf — this page is how staff see what's been
// established, sorted newest-first, without needing to act on any of it
// (the "Birr sees it afterward" half of the self-service model).
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import type { Foundation } from "../../lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  IconLandmark,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

export default function FoundationsPage() {
  const [foundations, setFoundations] = useState<Foundation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Foundation[]>("/foundations")
      .then((data) => {
        if (!cancelled) setFoundations(data);
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
          <IconLandmark className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Foundations</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Foundations and Waqf Funds are established directly by Founders — this is a read-only view of that
            activity, newest first.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load foundations" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && foundations === null && <FoundationsSkeleton />}

      {!error && foundations !== null && foundations.length === 0 && (
        <EmptyState
          title="No foundations yet"
          description="Foundations established by Founders will appear here."
        />
      )}

      {!error && foundations !== null && foundations.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Founder(s)</TableHeaderCell>
              <TableHeaderCell>Waqf Funds</TableHeaderCell>
              <TableHeaderCell>Jurisdiction</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {foundations.map((foundation) => (
              <TableRow key={foundation.id}>
                <TableCell>
                  <span className="font-medium text-slate-900">{foundation.name}</span>
                  {foundation.purpose && <p className="mt-0.5 text-xs text-slate-500">{foundation.purpose}</p>}
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  {foundation.foundationFounders.map((ff) => ff.founder.name).join(", ")}
                </TableCell>
                <TableCell>{foundation._count.waqfs}</TableCell>
                <TableCell>{foundation.jurisdiction ?? "—"}</TableCell>
                <TableCell>
                  <Badge tone={foundation.status === "active" ? "success" : "neutral"}>
                    {foundation.status === "active" ? "Active" : "Suspended"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function FoundationsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
