"use client";

// The manual/off-platform AML review CLAUDE.md's own dated note points
// to (2026-09-15) — VaultContributionsService.findOrCreateDonor's
// threshold check only ever recognizes a donor by email, so someone
// splitting one large gift across several emails never trips it
// automatically. Rather than an automatic clustering verdict, this
// surfaces the raw near-threshold data grouped by vault/currency so a
// compliance/risk staff member can judge for themselves whether a
// pattern looks like structuring — same "human in the loop" posture
// CLAUDE.md already applies to every other AI-advisory/judgment call in
// this codebase.
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatAmount, formatDate } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { StructuringReviewGroup } from "../../../lib/ops-types";
import { Alert, Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../_components/SectionChrome";

const REVIEW_ROLES = new Set(["platform_admin", "compliance_officer", "audit_committee", "board_of_trustees"]);

export default function VaultComplianceReviewPage() {
  const { staff } = useStaffSession();
  const canView = !!staff && REVIEW_ROLES.has(staff.staffRole);
  const [minFraction, setMinFraction] = useState(0.5);

  const {
    data: review,
    error,
  } = useLoadedResource(
    () =>
      canView
        ? apiFetchJson<{ groups: StructuringReviewGroup[] }>(`/vault-contributions/structuring-review?minFraction=${minFraction}`)
        : Promise.resolve({ groups: [] }),
    [canView, minFraction],
  );

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vault Giving — Compliance Review</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
          Confirmed contributions near a currency's identity threshold, grouped by vault and currency, from more
          than one donor. The in-app AML check only recognizes a donor by email — this list is the manual review
          that covers what it can't catch on its own: someone splitting one gift across several emails.
        </p>
      </header>

      {!canView && (
        <Alert tone="danger" title="Not available for your role">
          This review is scoped to Compliance Officer, Audit Committee, Board of Trustees, and Platform Admin.
        </Alert>
      )}

      {canView && (
        <>
          <div className="mb-6 flex items-center gap-3 text-sm text-slate-600">
            <label htmlFor="min-fraction" className="font-medium text-slate-700">
              Show gifts at or above
            </label>
            <select
              id="min-fraction"
              value={minFraction}
              onChange={(e) => setMinFraction(Number(e.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value={0.3}>30%</option>
              <option value={0.5}>50%</option>
              <option value={0.7}>70%</option>
              <option value={0.9}>90%</option>
            </select>
            <span>of that currency's identity threshold.</span>
          </div>

          {error && (
            <Alert tone="danger" title="Couldn't load the review">
              {error}
            </Alert>
          )}

          {!error && review === null && (
            <div className="space-y-3">
              <RowsSkeleton columns={4} />
            </div>
          )}

          {!error && review !== null && review.groups.length === 0 && (
            <EmptyState
              title="Nothing to review"
              description="No vault/currency has near-threshold gifts from more than one donor at this level."
            />
          )}

          {!error && review !== null && review.groups.length > 0 && (
            <div className="space-y-8">
              {review.groups.map((group) => (
                <section key={`${group.vaultId}:${group.currency}`}>
                  <SectionHeader
                    title={group.vaultName}
                    description={`${group.currency} — threshold ${formatAmount(group.thresholdAmount)} · ${group.distinctDonorCount} distinct givers near it`}
                  />
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Donor</TableHeaderCell>
                        <TableHeaderCell>Amount</TableHeaderCell>
                        <TableHeaderCell>% of threshold</TableHeaderCell>
                        <TableHeaderCell>ID on file</TableHeaderCell>
                        <TableHeaderCell>Given</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.contributions.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium text-slate-900">
                            {c.donorEmail ?? "Anonymous"}
                            {c.donorFullName && <span className="ml-1.5 font-normal text-slate-500">({c.donorFullName})</span>}
                          </TableCell>
                          <TableCell className="tabular-nums text-slate-500">
                            {group.currency} {formatAmount(c.amount)}
                          </TableCell>
                          <TableCell className="tabular-nums text-slate-500">{Math.round(c.fractionOfThreshold * 100)}%</TableCell>
                          <TableCell>
                            <Badge tone={c.donorIdCaptured ? "success" : "neutral"}>{c.donorIdCaptured ? "Yes" : "No"}</Badge>
                          </TableCell>
                          <TableCell className="text-slate-500">{formatDate(c.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
