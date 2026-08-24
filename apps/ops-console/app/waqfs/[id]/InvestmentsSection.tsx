"use client";

// Investment registration is plain CRUD — allocation changes are always
// a governed_actions investment.change action, handled on the Approval
// Queue page, never here.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import type { Investment } from "../../../lib/types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";

const INSTRUMENT_TYPES: Investment["instrumentType"][] = [
  "sukuk",
  "equity_fund",
  "real_estate_fund",
  "murabaha",
  "other",
];

export function InvestmentsSection({ waqfId }: { waqfId: string }) {
  const [investments, setInvestments] = useState<Investment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<Investment[]>(`/investments?waqfId=${waqfId}`)
      .then(setInvestments)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <SectionHeader
        title="Investments"
        description="Amounts of this fund allocated to an investment instrument."
        actionLabel={showForm ? "Cancel" : "Add investment"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load investments" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <InvestmentForm
          waqfId={waqfId}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {!error && investments === null && <RowsSkeleton columns={3} />}

      {!error && investments !== null && investments.length === 0 && !showForm && (
        <EmptyState title="No investments registered yet" description="Add one above to start tracking it." />
      )}

      {!error && investments !== null && investments.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Instrument</TableHeaderCell>
              <TableHeaderCell>Allocated amount</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {investments.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium text-slate-900">{i.name}</TableCell>
                <TableCell>{humanize(i.instrumentType)}</TableCell>
                <TableCell className="text-slate-500">{i.allocatedAmount}</TableCell>
                <TableCell>
                  <Badge tone={i.status === "active" ? "success" : "neutral"}>{humanize(i.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function InvestmentForm({ waqfId, onCreated }: { waqfId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [instrumentType, setInstrumentType] = useState<Investment["instrumentType"]>("sukuk");
  const [allocatedAmount, setAllocatedAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/investments", {
        method: "POST",
        body: JSON.stringify({ waqfId, name, instrumentType, allocatedAmount }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't add investment">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
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
        <div className="w-40 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Allocated amount</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            value={allocatedAmount}
            onChange={(e) => setAllocatedAmount(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
