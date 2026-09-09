"use client";

// Founder-facing, read-only — mirrors the Ops Console's own Proceeds
// section for this same waqf, minus the "Record proceeds" form (only
// Birr staff record these; see WaqfProceedsService.record's own
// comment). GET /waqf-proceeds already branches correctly for a founder
// session (WaqfProceedsController.list -> service.listForFounder,
// properly founder-scoped) — this component was simply never built to
// call it, so the backend's own founder-visibility path went unused
// (found 2026-09-04). Only rendered for Investment-type waqfs, same
// gate as InvestmentsSection.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate } from "../../../../lib/format";
import type { Investment, WaqfProceeds } from "../../../../lib/types";
import { Alert, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";

export function ProceedsSection({ waqfId }: { waqfId: string }) {
  const [proceeds, setProceeds] = useState<WaqfProceeds[] | null>(null);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<WaqfProceeds[]>(`/waqf-proceeds?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setProceeds(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  useEffect(() => {
    apiFetchJson<Investment[]>(`/investments?waqfId=${waqfId}`).then(setInvestments).catch(() => setInvestments([]));
  }, [waqfId]);

  const total = (proceeds ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Proceeds</p>
      <p className="mb-3 text-sm text-slate-500">
        Investment returns recorded over time — the corpus stays invested. Split across your selected causes
        proportionally, alongside your own corpus allocation.
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't load proceeds">
          {error}
        </Alert>
      )}

      {!error && proceeds === null && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {!error && proceeds !== null && proceeds.length === 0 && (
        <p className="text-sm text-slate-500">No proceeds recorded yet.</p>
      )}

      {!error && proceeds !== null && proceeds.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Total recorded: <span className="font-medium text-slate-900">{formatAmount(total)}</span>
          </p>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Amount</TableHeaderCell>
                <TableHeaderCell>Investment</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell>Recorded</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {proceeds.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-slate-900">
                    {p.currency} {formatAmount(p.amount)}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {investments.find((i) => i.id === p.investmentId)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">{p.description}</TableCell>
                  <TableCell className="whitespace-nowrap text-slate-500">{formatDate(p.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
