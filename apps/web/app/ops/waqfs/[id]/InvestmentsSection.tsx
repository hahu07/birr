"use client";

// Investment registration is plain CRUD — allocation changes are always
// a governed_actions investment.change action, decided on the Approval
// Queue page (never here). Propose control is the "Propose change"
// action per active-status row below (InvestmentChangeAction).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import type { Counterparty, Investment } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";

const INSTRUMENT_TYPES: Investment["instrumentType"][] = [
  "sukuk",
  "equity_fund",
  "real_estate_fund",
  "murabaha",
  "other",
];

export function InvestmentsSection({
  waqfId,
  amountRaised,
  corpusCurrency,
}: {
  waqfId: string;
  amountRaised: string;
  corpusCurrency: string | null;
}) {
  const [investments, setInvestments] = useState<Investment[] | null>(null);
  const [activeCounterparties, setActiveCounterparties] = useState<Counterparty[]>([]);
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

  useEffect(() => {
    apiFetchJson<Counterparty[]>("/counterparties?status=active")
      .then(setActiveCounterparties)
      .catch(() => setActiveCounterparties([]));
  }, []);

  // A waqf can't invest more corpus than it's actually raised — see
  // InvestmentsService's own comment. Liquidated investments have
  // released their corpus back, so only "active" ones count against it.
  const alreadyInvested = (investments ?? [])
    .filter((i) => i.status === "active")
    .reduce((sum, i) => sum + Number(i.allocatedAmount), 0);
  const availableToInvest = Number(amountRaised) - alreadyInvested;

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

      {showForm &&
        (activeCounterparties.length === 0 ? (
          <Alert tone="warning" title="No active counterparties yet" className="mb-4">
            Every investment needs an approved counterparty holding the money.{" "}
            <Link href="/ops/counterparties" className="font-medium underline">
              Register and onboard one
            </Link>{" "}
            first.
          </Alert>
        ) : (
          <InvestmentForm
            waqfId={waqfId}
            availableToInvest={availableToInvest}
            currency={corpusCurrency}
            counterparties={activeCounterparties}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        ))}

      {!error && investments === null && <RowsSkeleton columns={5} />}

      {!error && investments !== null && investments.length === 0 && !showForm && (
        <EmptyState title="No investments registered yet" description="Add one above to start tracking it." />
      )}

      {!error && investments !== null && investments.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Counterparty</TableHeaderCell>
              <TableHeaderCell>Instrument</TableHeaderCell>
              <TableHeaderCell>Allocated amount</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Date</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {investments.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium text-slate-900">{i.name}</TableCell>
                <TableCell className="text-slate-500">
                  {i.counterpartyId ? (
                    <Link href={`/ops/counterparties/${i.counterpartyId}`} className="hover:text-primary-700">
                      {activeCounterparties.find((c) => c.id === i.counterpartyId)?.name ?? "View →"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{humanize(i.instrumentType)}</TableCell>
                <TableCell className="text-slate-500">
                  {i.currency} {formatAmount(i.allocatedAmount)}
                  {i.placementId && (
                    <Link
                      href={`/ops/investment-placements/${i.placementId}`}
                      className="ml-1.5 text-xs text-slate-500 hover:text-primary-700"
                      title="Part of a bulk placement across multiple funds"
                    >
                      (placement →)
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  <Badge tone={i.status === "active" ? "success" : "neutral"}>{humanize(i.status)}</Badge>
                </TableCell>
                <TableCell className="text-slate-500">{formatDate(i.createdAt)}</TableCell>
                <TableCell>
                  {i.status === "active" && <InvestmentChangeAction investment={i} onProposed={load} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function InvestmentForm({
  waqfId,
  availableToInvest,
  currency,
  counterparties,
  onCreated,
}: {
  waqfId: string;
  availableToInvest: number;
  currency: string | null;
  counterparties: Counterparty[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [instrumentType, setInstrumentType] = useState<Investment["instrumentType"]>("sukuk");
  const [counterpartyId, setCounterpartyId] = useState(counterparties[0]?.id ?? "");
  const [allocatedAmount, setAllocatedAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = Number(allocatedAmount);
  const exceedsAvailable = allocatedAmount.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > availableToInvest;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (exceedsAvailable) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/investments", {
        method: "POST",
        body: JSON.stringify({ waqfId, name, instrumentType, allocatedAmount, counterpartyId }),
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
      <p className="text-sm text-slate-500">
        {currency} {availableToInvest.toLocaleString()} of this fund's raised corpus is uninvested.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input
            required
            autoFocus
            placeholder='e.g. "2026 Murabaha Tranche 1"'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Counterparty</label>
          <select
            value={counterpartyId}
            onChange={(e) => setCounterpartyId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
            max={availableToInvest}
            step="0.01"
            required
            value={allocatedAmount}
            onChange={(e) => setAllocatedAmount(e.target.value)}
          />
          {exceedsAvailable && (
            <p className="text-xs text-red-600">
              Only {currency} {availableToInvest.toLocaleString()} is uninvested.
            </p>
          )}
        </div>
        <Button type="submit" disabled={submitting || exceedsAvailable}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}

// Needs a value from staff (the new allocatedAmount), unlike a bare
// governed-action propose — a small bespoke inline component, same
// shape as CausesSection.tsx's own ProceedsAllocationCell, rather than
// forcing this into ProposeGovernedActionButton's no-input shape.
function InvestmentChangeAction({ investment, onProposed }: { investment: Investment; onProposed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [newAllocatedAmount, setNewAllocatedAmount] = useState(investment.allocatedAmount);
  const [submitting, setSubmitting] = useState(false);
  const [proposed, setProposed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (proposed) {
    return <span className="text-xs text-slate-500">Pending approval</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-xs font-medium text-primary-700 hover:underline"
        onClick={() => {
          setNewAllocatedAmount(investment.allocatedAmount);
          setError(null);
          setEditing(true);
        }}
      >
        Propose change
      </button>
    );
  }

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({
          permissionKey: "investment.change",
          payload: { investmentId: investment.id, newAllocatedAmount },
        }),
      });
      setEditing(false);
      setProposed(true);
      onProposed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handlePropose} className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min="0"
          step="0.01"
          required
          autoFocus
          className="w-28"
          value={newAllocatedAmount}
          onChange={(e) => setNewAllocatedAmount(e.target.value)}
        />
        <Button type="submit" disabled={submitting} className="px-2.5 py-1.5 text-xs">
          {submitting ? "Proposing…" : "Propose"}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </form>
  );
}
