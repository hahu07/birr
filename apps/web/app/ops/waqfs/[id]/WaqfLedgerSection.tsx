"use client";

// Read-only double-entry reports (2026-09-15) — Founder/Waqf-side
// counterpart to VaultLedgerSection. No currency switcher — unlike
// Vault, a Waqf Fund has one declared corpusCurrency, not an
// additionalCurrencies list.
//
// refreshKey (2026-09-15): recording an expense elsewhere on the page
// posts a journal entry this section's own reports should reflect —
// same sibling-staleness bug WaqfMilestonesSection had, fixed the same
// way: the parent page bumps a counter on any change, included in each
// LedgerTable's own fetch dependency array so it refetches without
// needing a full page reload.
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount } from "../../../../lib/format";
import type { WaqfLedgerAccountBalance } from "../../../../lib/ops-types";
import { Alert, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

export function WaqfLedgerSection({ waqfId, currency, refreshKey }: { waqfId: string; currency: string; refreshKey: number }) {
  return (
    <section>
      <SectionHeader title="Ledger" description="Double-entry trial balance and income & expenditure statement, sourced from every auto-posted journal entry." />

      <div className="grid gap-6 md:grid-cols-2">
        <LedgerTable title="Trial balance" endpoint={`/waqfs/${waqfId}/ledger/trial-balance`} currency={currency} refreshKey={refreshKey} />
        <LedgerTable title="Income & expenditure" endpoint={`/waqfs/${waqfId}/ledger/income-statement`} currency={currency} refreshKey={refreshKey} />
      </div>
    </section>
  );
}

function LedgerTable({ title, endpoint, currency, refreshKey }: { title: string; endpoint: string; currency: string; refreshKey: number }) {
  const {
    data: rows,
    error,
  } = useLoadedResource(
    () => apiFetchJson<WaqfLedgerAccountBalance[]>(`${endpoint}?currency=${encodeURIComponent(currency)}`),
    [endpoint, currency, refreshKey],
  );

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {error && (
        <Alert tone="danger" title="Couldn't load">
          {error}
        </Alert>
      )}
      {!error && rows === null && <RowsSkeleton columns={2} />}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState title="Nothing posted yet" description={`No ${currency} activity in this report.`} />
      )}
      {!error && rows !== null && rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Account</TableHeaderCell>
              <TableHeaderCell>Balance</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.ledgerAccountId}>
                <TableCell className="font-medium text-slate-900">
                  {r.code} — {r.name}
                </TableCell>
                <TableCell className="tabular-nums text-slate-500">
                  {currency} {formatAmount(r.balance)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
