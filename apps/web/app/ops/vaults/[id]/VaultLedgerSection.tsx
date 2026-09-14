"use client";

// Read-only double-entry reports (2026-09-13) — trial balance and
// income & expenditure statement, sourced from every VaultJournalEntry
// the three auto-posting hooks (confirmed contribution, paid
// distribution, recorded expense) have written. Per-currency, never
// summed across currencies — see VaultsService.withAmountRaised's own
// comment on why this codebase never converts between currencies.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount } from "../../../../lib/format";
import type { VaultLedgerAccountBalance } from "../../../../lib/ops-types";
import { Alert, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

export function VaultLedgerSection({ vaultId, currency, additionalCurrencies }: { vaultId: string; currency: string; additionalCurrencies: string[] }) {
  const currencies = [currency, ...additionalCurrencies];
  const [selectedCurrency, setSelectedCurrency] = useState(currency);

  return (
    <section>
      <SectionHeader title="Ledger" description="Double-entry trial balance and income & expenditure statement, sourced from every auto-posted journal entry." />

      {currencies.length > 1 && (
        <div className="mb-4 flex gap-2">
          {currencies.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setSelectedCurrency(c)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                selectedCurrency === c ? "bg-primary-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <LedgerTable title="Trial balance" endpoint={`/vaults/${vaultId}/ledger/trial-balance`} currency={selectedCurrency} />
        <LedgerTable title="Income & expenditure" endpoint={`/vaults/${vaultId}/ledger/income-statement`} currency={selectedCurrency} />
      </div>
    </section>
  );
}

function LedgerTable({ title, endpoint, currency }: { title: string; endpoint: string; currency: string }) {
  const {
    data: rows,
    error,
  } = useLoadedResource(
    () => apiFetchJson<VaultLedgerAccountBalance[]>(`${endpoint}?currency=${encodeURIComponent(currency)}`),
    [endpoint, currency],
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
