"use client";

// Founder-facing, read-only — mirrors the Ops Console's own Investments
// section for this same waqf. No PII concern (an instrument holding
// isn't a person), so this shows the real rows — see
// InvestmentsService.listForFounder's own comment.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import type { Investment } from "../../../../lib/types";
import { Alert, Badge, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";

export function InvestmentsSection({ waqfId }: { waqfId: string }) {
  const [investments, setInvestments] = useState<Investment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Investment[]>(`/investments?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setInvestments(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Investments</p>
      <p className="mb-3 text-sm text-slate-500">How this fund's value is allocated.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load investments">
          {error}
        </Alert>
      )}

      {!error && investments === null && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {!error && investments !== null && investments.length === 0 && (
        <p className="text-sm text-slate-500">No investments allocated yet.</p>
      )}

      {!error && investments !== null && investments.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Instrument</TableHeaderCell>
              <TableHeaderCell>Allocated</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Since</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {investments.map((investment) => (
              <TableRow key={investment.id}>
                <TableCell className="font-medium text-slate-900">{investment.name}</TableCell>
                <TableCell className="text-slate-500">{humanize(investment.instrumentType)}</TableCell>
                <TableCell className="text-slate-500">{formatAmount(investment.allocatedAmount)}</TableCell>
                <TableCell>
                  <Badge tone={investment.status === "active" ? "success" : "neutral"}>
                    {humanize(investment.status)}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-500">{formatDate(investment.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
