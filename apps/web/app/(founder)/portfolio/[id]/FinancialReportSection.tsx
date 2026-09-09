"use client";

// Financial Report — mirrors the Ops Console's own FinancialReportSection.tsx
// exactly (same shared report shape, same on-screen layout, print-to-PDF
// export) — this file only differs in its lib/ imports. Assembled fresh
// on every "Generate report" click (FinancialReportsService.generate(),
// GET /financial-reports/:waqfId), not a persisted document. Every
// generate() call writes its own audit_logs entry
// ("financial_report.exported"), so this only fires on explicit action,
// never silently on page visit — and is the real signal
// WaqfsService.getLifecycleStatus's financialReporting stage checks.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate } from "../../../../lib/format";
import type { FinancialReport } from "../../../../lib/types";
import {
  Alert,
  Button,
  DetailGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

export function FinancialReportSection({ waqfId }: { waqfId: string }) {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetchJson<FinancialReport>(`/financial-reports/${waqfId}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Financial Report</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Raised, distributed, and cause allocations for this waqf, assembled fresh on request.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {report && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
          )}
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={loading} onClick={generate}>
            {loading ? "Generating…" : report ? "Regenerate" : "Generate report"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't generate report" className="mb-4">
          {error}
        </Alert>
      )}

      {report && (
        <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-5">
          <DetailGrid
            columns={3}
            items={[
              {
                label: "Corpus target",
                value: report.waqf.corpusAmount
                  ? `${report.waqf.corpusCurrency} ${formatAmount(report.waqf.corpusAmount)}`
                  : "Not declared",
              },
              { label: "Jurisdiction", value: report.waqf.jurisdiction },
              { label: "Generated", value: formatDate(report.generatedAt) },
            ]}
            className="border-b border-slate-100 pb-5"
          />

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Raised</p>
              {report.raised.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing confirmed yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {report.raised.map((r) => (
                    <li key={r.currency} className="font-medium text-slate-900">
                      {r.currency} {formatAmount(r.totalAmount)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Distributed</p>
              {report.distributed.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing paid out yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {report.distributed.map((d) => (
                    <li key={d.currency} className="font-medium text-slate-900">
                      {d.currency} {formatAmount(d.totalAmount)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              By cause ({report.distributionsByCause.length})
            </p>
            {report.distributionsByCause.length === 0 ? (
              <p className="text-sm text-slate-500">No paid distributions yet.</p>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Cause</TableHeaderCell>
                    <TableHeaderCell>Currency</TableHeaderCell>
                    <TableHeaderCell>Distributed</TableHeaderCell>
                    <TableHeaderCell>Distributions</TableHeaderCell>
                    <TableHeaderCell>Beneficiaries</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.distributionsByCause.map((row) => (
                    <TableRow key={`${row.causeId}-${row.currency}`}>
                      <TableCell className="font-medium text-slate-900">{row.causeName}</TableCell>
                      <TableCell className="text-slate-500">{row.currency}</TableCell>
                      <TableCell className="text-slate-500">{formatAmount(row.totalAmount)}</TableCell>
                      <TableCell className="text-slate-500">{row.distributionCount}</TableCell>
                      <TableCell className="text-slate-500">{row.beneficiaryCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {report.proceeds && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Investment proceeds</p>
              <p className="text-sm font-medium text-slate-900">{formatAmount(report.proceeds.total)} recorded</p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Cause allocations ({report.causeAllocations.length})
            </p>
            {report.causeAllocations.length === 0 ? (
              <p className="text-sm text-slate-500">No causes selected for this waqf yet.</p>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Cause</TableHeaderCell>
                    <TableHeaderCell>Corpus allocated</TableHeaderCell>
                    <TableHeaderCell>Proceeds allocated</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.causeAllocations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                      <TableCell className="text-slate-500">
                        {c.allocatedAmount ? formatAmount(c.allocatedAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {c.proceedsAllocatedAmount ? formatAmount(c.proceedsAllocatedAmount) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
