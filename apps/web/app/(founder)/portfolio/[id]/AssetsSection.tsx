"use client";

// Founder-facing, read-only — mirrors the Ops Console's own Assets
// section for this same waqf, minus the ability to add or dispose one
// (that stays Birr-staff-mediated: registration is plain CRUD on the Ops
// side, disposal is always a governed_actions action). No PII concern
// here (an asset isn't a person), so this shows the real rows, not an
// aggregate — see AssetsService.listForFounder's own comment.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, formatMoney, humanize } from "../../../../lib/format";
import type { Asset } from "../../../../lib/types";
import { Alert, Badge, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";

export function AssetsSection({ waqfId }: { waqfId: string }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Asset[]>(`/assets?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setAssets(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  return (
    <div className="mt-8 border-t border-slate-100 pt-7">
      <p className="mb-1 text-[15px] font-semibold text-slate-900">Assets</p>
      <p className="mb-4 text-sm text-slate-500">What this fund actually holds.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load assets">
          {error}
        </Alert>
      )}

      {!error && assets === null && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {!error && assets !== null && assets.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-sm text-slate-500">No assets registered yet.</p>
      )}

      {!error && assets !== null && assets.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Value</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Registered</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {assets.map((asset) => (
              <TableRow key={asset.id}>
                <TableCell className="font-medium text-slate-900">{asset.name}</TableCell>
                <TableCell className="text-slate-500">{humanize(asset.category)}</TableCell>
                <TableCell className="tabular-nums text-slate-700">{formatMoney(asset.estimatedValue, asset.currency)}</TableCell>
                <TableCell>
                  <Badge tone={asset.status === "active" ? "success" : "neutral"}>{humanize(asset.status)}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-500">{formatDate(asset.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
