"use client";

// Read-only, for Birr staff oversight/audit of the actual payment
// record behind a waqf's funding progress — no create-form, unlike
// AssetsSection: a contribution is always founder-initiated real money
// movement (POST /contributions, Founder Portal only), never something
// staff enters on someone's behalf.
import { apiFetchJson } from "../../../../lib/api";
import { humanize, formatAmount, formatDate } from "../../../../lib/format";
import type { Contribution } from "../../../../lib/ops-types";
import { Alert, Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

const STATUS_TONE: Record<Contribution["status"], "success" | "warning" | "danger"> = {
  pending: "warning",
  confirmed: "success",
  failed: "danger",
};

export function ContributionsSection({ waqfId }: { waqfId: string }) {
  const { data: contributions, error } = useLoadedResource(() => apiFetchJson<Contribution[]>(`/contributions?waqfId=${waqfId}`), [waqfId]);

  return (
    <section>
      <SectionHeader title="Contributions" description="The actual payment record behind this fund's corpus." />

      {error && (
        <Alert tone="danger" title="Couldn't load contributions" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && contributions === null && <RowsSkeleton columns={4} />}

      {!error && contributions !== null && contributions.length === 0 && (
        <EmptyState title="No contributions yet" description="Nothing has been paid toward this fund's corpus yet." />
      )}

      {!error && contributions !== null && contributions.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Method</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Date</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {contributions.map((contribution) => (
              <TableRow key={contribution.id}>
                <TableCell className="font-medium text-slate-900">
                  {contribution.currency} {formatAmount(contribution.amount)}
                </TableCell>
                <TableCell>{humanize(contribution.provider)}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[contribution.status]}>{humanize(contribution.status)}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-500">
                  {formatDate(contribution.confirmedAt ?? contribution.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
