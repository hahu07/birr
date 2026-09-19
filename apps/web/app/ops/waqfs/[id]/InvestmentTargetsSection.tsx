"use client";

// Staff-set target allocation by instrument type, and the drift
// computation against it — see InvestmentTarget's own schema comment
// on the backend for the full reasoning. Unlike FinancialReportSection's
// on-demand-only pattern, both the target list and the drift breakdown
// load on mount (a small, cheap computation, not a heavy assembled
// report). PortfolioDriftScheduler proactively notifies staff when a
// fund drifts past the threshold — this section is where they see the
// actual breakdown, whether they arrived from that notification or are
// just checking in on the fund directly.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { Investment, InvestmentTarget, WaqfPortfolioDriftReport } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

const INSTRUMENT_TYPES: Investment["instrumentType"][] = [
  "sukuk",
  "equity_fund",
  "real_estate_fund",
  "murabaha",
  "other",
];

export function InvestmentTargetsSection({ waqfId }: { waqfId: string }) {
  const { staff } = useStaffSession();
  const canSetTargets = staff?.staffRole === "investment_committee";
  const [showForm, setShowForm] = useState(false);

  const {
    data: targets,
    error: targetsError,
    reload: loadTargets,
  } = useLoadedResource(() => apiFetchJson<InvestmentTarget[]>(`/investment-targets?waqfId=${waqfId}`), [waqfId]);
  const {
    data: drift,
    error: driftError,
    reload: loadDrift,
  } = useLoadedResource(() => apiFetchJson<WaqfPortfolioDriftReport>(`/investment-targets/${waqfId}/drift`), [waqfId]);

  function reload() {
    loadTargets();
    loadDrift();
  }

  const error = targetsError ?? driftError;

  async function removeTarget(instrumentType: Investment["instrumentType"]) {
    await apiFetchJson(`/investment-targets/${waqfId}/${instrumentType}`, { method: "DELETE" });
    reload();
  }

  return (
    <section>
      <SectionHeader
        title="Investment Targets"
        description="Target % mix by instrument type — flags when this fund's actual investment composition drifts too far from it."
        actionLabel={canSetTargets ? (showForm ? "Cancel" : "Set target") : undefined}
        onAction={canSetTargets ? () => setShowForm((v) => !v) : undefined}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load investment targets" className="mb-4">
          {error}
        </Alert>
      )}

      {canSetTargets && showForm && (
        <TargetForm
          waqfId={waqfId}
          onSaved={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      {!error && (targets === null || drift === null) && <RowsSkeleton columns={5} />}

      {!error && targets !== null && drift !== null && targets.length === 0 && (
        <EmptyState
          title="No targets set yet"
          description="Set a target % per instrument type above to start tracking drift for this fund."
        />
      )}

      {!error && drift !== null && drift.breakdown.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Instrument</TableHeaderCell>
              <TableHeaderCell>Target %</TableHeaderCell>
              <TableHeaderCell>Actual %</TableHeaderCell>
              <TableHeaderCell>Actual amount</TableHeaderCell>
              <TableHeaderCell>Drift</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              {canSetTargets && <TableHeaderCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {drift.breakdown.map((b) => (
              <TableRow key={b.instrumentType}>
                <TableCell className="font-medium text-slate-900">{humanize(b.instrumentType)}</TableCell>
                <TableCell className="text-slate-500">{b.targetPercent}%</TableCell>
                <TableCell className="text-slate-500">{b.actualPercent}%</TableCell>
                <TableCell className="text-slate-500">
                  {drift.currency} {formatAmount(b.actualAmount)}
                </TableCell>
                <TableCell className="text-slate-500">
                  {Number(b.driftPercentagePoints) > 0 ? "+" : ""}
                  {b.driftPercentagePoints}pp
                </TableCell>
                <TableCell>
                  <Badge tone={b.drifted ? "warning" : "success"}>{b.drifted ? "Drifted" : "On target"}</Badge>
                </TableCell>
                {canSetTargets && (
                  <TableCell>
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-500 hover:text-red-600 hover:underline"
                      onClick={() => removeTarget(b.instrumentType)}
                    >
                      Remove
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function TargetForm({ waqfId, onSaved }: { waqfId: string; onSaved: () => void }) {
  const [instrumentType, setInstrumentType] = useState<Investment["instrumentType"]>("sukuk");
  const [targetPercent, setTargetPercent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/investment-targets", {
        method: "POST",
        body: JSON.stringify({ waqfId, instrumentType, targetPercent }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't set target">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Instrument</label>
          <select
            value={instrumentType}
            onChange={(e) => setInstrumentType(e.target.value as Investment["instrumentType"])}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {INSTRUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Target %</label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            autoFocus
            value={targetPercent}
            onChange={(e) => setTargetPercent(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
