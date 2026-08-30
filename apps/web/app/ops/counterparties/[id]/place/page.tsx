"use client";

// Bulk-place one counterparty+instrument tranche across many Waqf Funds
// at once, instead of one POST /investments per fund from each waqf's
// own page. See InvestmentPlacementsService's own comment on the
// backend for the full reasoning (all-or-nothing transaction, combined
// concentration-limit check, currency-consistency guard).
//
// Fund selection is search-to-add, not a rendered checklist of every
// Investment-type Waqf Fund: at real scale (many Foundations, several
// funds each) a flat or even Foundation-grouped list becomes a wall of
// UI to scroll through, and there's no way to tell two similarly-named
// funds under different Foundations apart at a glance. Typing narrows
// results server-side (GET /waqfs?type=investment&search=), each result
// carries its own Foundation's name, and picking one moves it into a
// separate "selected" list — so the page never renders more than a
// handful of rows at once, regardless of how many funds exist.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import { formatAmount, humanize } from "../../../../../lib/format";
import type { Counterparty, Investment, InvestmentInstrumentType, Waqf } from "../../../../../lib/ops-types";
import { Alert, Badge, Button, Card, Input } from "@birr/ui";

const INSTRUMENT_TYPES: InvestmentInstrumentType[] = ["sukuk", "equity_fund", "real_estate_fund", "murabaha", "other"];

interface FundAvailability {
  amountRaised: number;
  alreadyInvested: number;
}

export default function PlaceInvestmentPage() {
  const { id: counterpartyId } = useParams<{ id: string }>();
  const router = useRouter();

  const [counterparty, setCounterparty] = useState<Counterparty | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [instrumentType, setInstrumentType] = useState<InvestmentInstrumentType>("sukuk");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Waqf[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Waqf[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<Record<string, FundAvailability>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<Counterparty>(`/counterparties/${counterpartyId}`)
      .then(setCounterparty)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Something went wrong."));
  }, [counterpartyId]);

  // Debounced search-as-you-type. Empty query still runs (shows the
  // most recently created Investment-type funds) so the box isn't a
  // dead end for an officer who doesn't know exact names yet.
  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ type: "investment" });
      if (query.trim()) params.set("search", query.trim());
      apiFetchJson<Waqf[]>(`/waqfs?${params.toString()}`)
        .then((waqfs) => setResults(waqfs.filter((w) => !selected.some((s) => s.id === w.id))))
        .catch((err: unknown) => setSearchError(err instanceof Error ? err.message : "Something went wrong."));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selected]);

  function addWaqf(w: Waqf) {
    setSelected((prev) => [...prev, w]);
    setResults((prev) => prev?.filter((r) => r.id !== w.id) ?? null);
    // Lazily fetch this fund's real available-to-invest ceiling only
    // once it's actually picked, not for every search result — see
    // InvestmentsSection.tsx's own availableToInvest logic, mirrored
    // here. GET /waqfs list doesn't carry amountRaised (only
    // GET /waqfs/:id does), so this is the cheapest accurate path.
    Promise.all([apiFetchJson<Waqf>(`/waqfs/${w.id}`), apiFetchJson<Investment[]>(`/investments?waqfId=${w.id}`)])
      .then(([waqf, investments]) => {
        const alreadyInvested = investments
          .filter((i) => i.status === "active")
          .reduce((sum, i) => sum + Number(i.allocatedAmount), 0);
        setAvailability((prev) => ({
          ...prev,
          [w.id]: { amountRaised: Number(waqf.amountRaised ?? "0"), alreadyInvested },
        }));
      })
      .catch(() => {
        /* Best-effort preview only — the server re-validates for real on submit. */
      });
  }

  function removeWaqf(waqfId: string) {
    setSelected((prev) => prev.filter((w) => w.id !== waqfId));
    setAmounts((prev) => {
      const { [waqfId]: _removed, ...rest } = prev;
      return rest;
    });
  }

  const currencies = new Set(selected.map((w) => w.corpusCurrency ?? "(none set)"));
  const currencyMismatch = currencies.size > 1;

  const allocations = selected
    .map((w) => ({ waqfId: w.id, amount: (amounts[w.id] ?? "").trim() }))
    .filter((a) => a.amount.length > 0);

  const canSubmit =
    name.trim().length > 0 &&
    !currencyMismatch &&
    allocations.length > 0 &&
    allocations.every((a) => Number(a.amount) > 0) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const placement = await apiFetchJson<{ id: string }>("/investment-placements", {
        method: "POST",
        body: JSON.stringify({ name, instrumentType, counterpartyId, allocations }),
      });
      router.push(`/ops/investment-placements/${placement.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Alert tone="danger" title="Couldn't load this page">
        {loadError}
      </Alert>
    );
  }

  if (!counterparty) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/ops/counterparties/${counterpartyId}`}
        className="text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        ← {counterparty.name}
      </Link>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Place investment across funds</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          One placement with {counterparty.name}, split across as many Waqf Funds as you select — each fund gets its
          own Investment record, checked against its own raised corpus and this counterparty's combined
          concentration limit.
        </p>
      </header>

      {submitError && (
        <Alert tone="danger" title="Couldn't create this placement" className="mb-4">
          {submitError}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1 space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Placement name</label>
              <Input
                required
                autoFocus
                placeholder='e.g. "2026 Murabaha Tranche 1"'
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Instrument</label>
              <select
                value={instrumentType}
                onChange={(e) => setInstrumentType(e.target.value as InvestmentInstrumentType)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {INSTRUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <Card>
          <p className="mb-1 text-sm font-medium text-slate-700">Contributing funds</p>
          <p className="mb-3 text-xs text-slate-500">
            Search by fund or Foundation name, add every Investment-type Waqf Fund putting money into this
            placement, then set each one's amount.
          </p>

          {currencyMismatch && (
            <Alert tone="warning" title="Selected funds don't share a corpus currency" className="mb-3">
              Every fund in one placement must share a currency — currently selected: {[...currencies].join(", ")}.
              Remove the mismatched fund(s) before submitting.
            </Alert>
          )}

          {searchError && (
            <Alert tone="danger" title="Couldn't search funds" className="mb-3">
              {searchError}
            </Alert>
          )}

          <Input
            placeholder="Search funds or Foundations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2"
          />

          {results !== null && (
            <div className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-1.5">
              {results.length === 0 ? (
                <p className="p-2 text-xs text-slate-400">No matching Investment-type Waqf Funds.</p>
              ) : (
                results.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-slate-50">
                    <span className="text-sm text-slate-700">
                      <span className="font-medium text-slate-900">{w.name}</span>
                      <span className="text-slate-400"> · {w.foundation.name}</span>
                      {w.corpusCurrency && (
                        <Badge tone="neutral" className="ml-2">
                          {w.corpusCurrency}
                        </Badge>
                      )}
                    </span>
                    <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => addWaqf(w)}>
                      + Add
                    </Button>
                  </div>
                ))
              )}
              {results.length >= 50 && (
                <p className="p-2 text-[11px] text-slate-400">Showing the first 50 matches — refine your search to narrow further.</p>
              )}
            </div>
          )}

          <p className="mb-1 text-sm font-medium text-slate-700">Selected ({selected.length})</p>
          {selected.length === 0 ? (
            <p className="text-sm text-slate-400">No funds selected yet — search above to add one.</p>
          ) : (
            <div className="space-y-1">
              {selected.map((w) => {
                const avail = availability[w.id];
                const remaining = avail ? avail.amountRaised - avail.alreadyInvested : undefined;
                return (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-primary-200 bg-primary-50 px-3 py-2"
                  >
                    <div className="min-w-[12rem] flex-1">
                      <span className="text-sm font-medium text-slate-800">{w.name}</span>
                      <span className="text-slate-400"> · {w.foundation.name}</span>
                      {w.corpusCurrency && (
                        <Badge tone="neutral" className="ml-2">
                          {w.corpusCurrency}
                        </Badge>
                      )}
                    </div>
                    <div className="w-40 space-y-0.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        value={amounts[w.id] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [w.id]: e.target.value }))}
                      />
                      {remaining !== undefined && (
                        <p className={`text-[11px] ${remaining < 0 ? "text-red-600" : "text-slate-400"}`}>
                          {formatAmount(Math.max(remaining, 0))} uninvested
                        </p>
                      )}
                    </div>
                    <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => removeWaqf(w.id)}>
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Placing…" : `Place across ${allocations.length || 0} fund${allocations.length === 1 ? "" : "s"}`}
          </Button>
          <Link href={`/ops/counterparties/${counterpartyId}`} className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
