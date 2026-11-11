"use client";

// The calculator itself — runs entirely in the browser through
// @birr/zakah, the same engine the backend and the future mobile app use.
// Nothing the visitor types is sent anywhere: the page only downloads the
// approved rulesets and today's prices (see page.tsx).
import { useMemo, useState } from "react";
import {
  calculateZakah,
  karatToPurity,
  PricesExpiredError,
  ZakahInputError,
  type MetalHolding,
  type MetalPrices,
  type ZakahResult,
  type ZakahRuleset,
} from "@birr/zakah";
import { Alert, Button, Input, Select } from "@birr/ui";
import { formatDate, formatMoney } from "../../../lib/format";
import { PayZakahForm, type ZakahPaymentTerms } from "./PayZakahForm";

const GOLD_PURITIES = [
  { label: "24k (pure)", value: karatToPurity(24) },
  { label: "22k", value: karatToPurity(22) },
  { label: "21k", value: karatToPurity(21) },
  { label: "18k", value: karatToPurity(18) },
  { label: "14k", value: karatToPurity(14) },
];
const SILVER_PURITIES = [
  { label: "Fine (999)", value: "0.999" },
  { label: "Sterling (925)", value: "0.925" },
  { label: "800", value: "0.8" },
];

interface MetalRow extends MetalHolding {
  id: number;
}

const FIELD_LABELS: Record<string, string> = {
  cash: "Cash and bank balances",
  tradeGoods: "Business stock",
  receivables: "Money owed to you",
  debtsDueNow: "Debts you must pay now",
};

/** "1,500,000" or " 1500000 " → "1500000"; blank → "0". */
function normaliseAmount(raw: string): string {
  const cleaned = raw.replace(/[,\s₦]/g, "");
  return cleaned === "" ? "0" : cleaned;
}

function naira(amount: string) {
  return formatMoney(amount, "NGN");
}

type Outcome =
  | { kind: "result"; result: ZakahResult }
  | { kind: "input_error"; message: string }
  | { kind: "prices_expired" };

export function ZakahCalculator({
  rulesets,
  prices,
  today,
  paymentTerms = null,
}: {
  rulesets: ZakahRuleset[];
  prices: MetalPrices;
  today: string;
  /** null when the payment terms couldn't be loaded — the calculator still works. */
  paymentTerms?: ZakahPaymentTerms | null;
}) {
  const [rulesetId, setRulesetId] = useState(() => (rulesets.find((r) => r.madhhab === "maliki") ?? rulesets[0]).id);
  const [amounts, setAmounts] = useState({ cash: "", tradeGoods: "", receivables: "", debtsDueNow: "" });
  const [metals, setMetals] = useState<MetalRow[]>([]);
  const [nextMetalId, setNextMetalId] = useState(1);
  const [heldAYear, setHeldAYear] = useState(false);

  const ruleset = rulesets.find((r) => r.id === rulesetId) ?? rulesets[0];

  const outcome = useMemo<Outcome>(() => {
    try {
      const result = calculateZakah(
        {
          cash: normaliseAmount(amounts.cash),
          tradeGoods: normaliseAmount(amounts.tradeGoods),
          receivables: normaliseAmount(amounts.receivables),
          debtsDueNow: normaliseAmount(amounts.debtsDueNow),
          metals: metals.map(({ metal, grams, purity, personalUse }) => ({
            metal,
            grams: normaliseAmount(grams),
            purity,
            personalUse,
          })),
        },
        ruleset,
        prices,
        { today },
      );
      return { kind: "result", result };
    } catch (err) {
      if (err instanceof PricesExpiredError) return { kind: "prices_expired" };
      if (err instanceof ZakahInputError) {
        const metalField = /^metals\[(\d+)\]\.grams$/.exec(err.field);
        const label = metalField ? `Weight of item ${Number(metalField[1]) + 1}` : (FIELD_LABELS[err.field] ?? err.field);
        return { kind: "input_error", message: `${label}: please enter a number, like 250000.` };
      }
      throw err;
    }
  }, [amounts, metals, ruleset, prices, today]);

  function setAmount(field: keyof typeof amounts, value: string) {
    setAmounts((a) => ({ ...a, [field]: value }));
  }
  function addMetal(metal: "gold" | "silver") {
    setMetals((m) => [
      ...m,
      { id: nextMetalId, metal, grams: "", purity: metal === "gold" ? karatToPurity(18) : "0.925", personalUse: true },
    ]);
    setNextMetalId((n) => n + 1);
  }
  function updateMetal(id: number, change: Partial<MetalHolding>) {
    setMetals((m) => m.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="space-y-8">
        {rulesets.length > 1 && (
          <fieldset>
            <legend className="text-base font-semibold text-slate-900">Your school of thought</legend>
            <p className="mt-1 text-sm text-slate-500">The schools differ on a few points, such as jewellery and debts.</p>
            <label htmlFor="zakah-ruleset" className="sr-only">School of thought</label>
            <Select id="zakah-ruleset" className="mt-3 w-full sm:w-72" value={rulesetId} onChange={(e) => setRulesetId(e.target.value)}>
              {rulesets.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </fieldset>
        )}

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-slate-900">What you own</legend>
          <AmountField id="cash" label={FIELD_LABELS.cash} hint="Including savings and mobile-money wallets." value={amounts.cash} onChange={(v) => setAmount("cash", v)} />
          <AmountField id="tradeGoods" label={FIELD_LABELS.tradeGoods} hint="What your stock would sell for today." value={amounts.tradeGoods} onChange={(v) => setAmount("tradeGoods", v)} />
          <AmountField id="receivables" label={FIELD_LABELS.receivables} hint="Only money you expect to be paid back." value={amounts.receivables} onChange={(v) => setAmount("receivables", v)} />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-slate-900">Gold and silver</legend>
          {metals.length === 0 && <p className="text-sm text-slate-500">Add jewellery, coins or bars you own.</p>}
          {metals.map((row, i) => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900">
                  {row.metal === "gold" ? "Gold" : "Silver"}, item {i + 1}
                </p>
                <button
                  type="button"
                  className="text-xs font-medium text-slate-500 hover:text-red-600"
                  onClick={() => setMetals((m) => m.filter((r) => r.id !== row.id))}
                >
                  Remove
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`metal-${row.id}-grams`} className="mb-1.5 block text-sm text-slate-700">Weight (grams)</label>
                  <Input id={`metal-${row.id}-grams`} inputMode="decimal" placeholder="e.g. 20" value={row.grams} onChange={(e) => updateMetal(row.id, { grams: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`metal-${row.id}-purity`} className="mb-1.5 block text-sm text-slate-700">Purity</label>
                  <Select id={`metal-${row.id}-purity`} className="w-full" value={row.purity} onChange={(e) => updateMetal(row.id, { purity: e.target.value })}>
                    {(row.metal === "gold" ? GOLD_PURITIES : SILVER_PURITIES).map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={row.personalUse}
                  onChange={(e) => updateMetal(row.id, { personalUse: e.target.checked })}
                />
                <span>I wear this as jewellery (not kept as savings)</span>
              </label>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => addMetal("gold")}>
              Add gold
            </Button>
            <Button type="button" variant="secondary" onClick={() => addMetal("silver")}>
              Add silver
            </Button>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-slate-900">What you owe</legend>
          <AmountField id="debtsDueNow" label={FIELD_LABELS.debtsDueNow} hint="Only what's due now, such as this month's rent — not the whole of a long loan." value={amounts.debtsDueNow} onChange={(v) => setAmount("debtsDueNow", v)} />
        </fieldset>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" checked={heldAYear} onChange={(e) => setHeldAYear(e.target.checked)} />
          <span>
            <span className="font-medium text-slate-900">I&apos;ve held this wealth for a full lunar year.</span> Zakah is only due on
            wealth you&apos;ve owned for one Islamic (hijri) year, called the hawl.
          </span>
        </label>
      </div>

      <ResultPanel outcome={outcome} heldAYear={heldAYear} ruleset={ruleset} prices={prices} paymentTerms={paymentTerms} />
    </div>
  );
}

function AmountField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={`zakah-${id}`} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <p id={`zakah-${id}-hint`} className="mb-1.5 text-xs text-slate-500">
        {hint}
      </p>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">₦</span>
        <Input
          id={`zakah-${id}`}
          aria-describedby={`zakah-${id}-hint`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          className="pl-7 tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function ResultPanel({
  outcome,
  heldAYear,
  ruleset,
  prices,
  paymentTerms,
}: {
  outcome: Outcome;
  heldAYear: boolean;
  ruleset: ZakahRuleset;
  prices: MetalPrices;
  paymentTerms: ZakahPaymentTerms | null;
}) {
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {outcome.kind === "prices_expired" && (
        <Alert tone="warning" title="Prices are out of date">
          Today&apos;s gold and silver prices haven&apos;t been updated recently, so we can&apos;t work out the nisab. Please check back soon.
        </Alert>
      )}
      {outcome.kind === "input_error" && (
        <Alert tone="danger" title="Check your figures">
          {outcome.message}
        </Alert>
      )}
      {outcome.kind === "result" && <ResultDetails result={outcome.result} heldAYear={heldAYear} />}
      {outcome.kind === "result" && heldAYear && outcome.result.meetsNisab && (
        paymentTerms?.available ? (
          // Keyed by the figure, so the amount resets when the calculation changes.
          <PayZakahForm
            key={outcome.result.zakahDue}
            zakahDue={outcome.result.zakahDue}
            ruleset={{ key: outcome.result.ruleset.id, version: outcome.result.ruleset.version }}
            terms={paymentTerms}
          />
        ) : (
          <p className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-600">Paying your zakah through Birr opens soon.</p>
        )
      )}

      <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">
        Uses the {ruleset.label} ruleset (version {ruleset.version}), approved by Birr&apos;s Shariah Supervisory Board, and gold
        and silver prices from {formatDate(prices.asOf)} ({prices.source}). Your figures stay on this device — nothing you type is
        sent to Birr. This is a calculation tool, not a fatwa; for unusual situations, ask a scholar you trust.
      </p>
    </aside>
  );
}

function ResultDetails({ result, heldAYear }: { result: ZakahResult; heldAYear: boolean }) {
  const counted = result.lines.filter((l) => l.kind !== "debts" && Number(l.value) > 0);
  const debts = result.lines.find((l) => l.kind === "debts");

  return (
    <div>
      {result.priceFreshness.status === "stale" && (
        <Alert tone="warning" title="Prices are over a week old" className="mb-4">
          Gold and silver prices were last updated {result.priceFreshness.ageDays} days ago, so the nisab may have moved since.
        </Alert>
      )}

      <div aria-live="polite">
      <p className="text-sm font-medium text-slate-500">Your zakah</p>
      {!heldAYear ? (
        <p className="mt-2 text-sm text-slate-600">Tick the box confirming you&apos;ve held this wealth for a full lunar year to see what you owe.</p>
      ) : result.meetsNisab ? (
        <>
          <p className="font-display mt-1 text-4xl font-medium tabular-nums tracking-tight text-slate-900">{naira(result.zakahDue)}</p>
          <p className="mt-1 text-sm text-slate-600">2.5% of {naira(result.netZakatableWealth)}</p>
        </>
      ) : (
        <>
          <p className="font-display mt-1 text-4xl font-medium tabular-nums tracking-tight text-slate-900">{naira("0")}</p>
          <p className="mt-1 text-sm text-slate-600">
            {Number(result.netZakatableWealth) > 0
              ? `Your wealth is below the nisab, so no zakah is due this year.`
              : "Enter what you own to see your zakah."}
          </p>
        </>
      )}

      </div>

      <dl className="mt-5 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Nisab today</dt>
          <dd className="text-right tabular-nums text-slate-900">
            {naira(result.nisab.value)}
            <span className="block text-xs text-slate-500">
              {result.nisab.grams}g of {result.nisab.metal}
            </span>
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Wealth counted</dt>
          <dd className="tabular-nums text-slate-900">{naira(result.totalAssets)}</dd>
        </div>
        {Number(result.deductedDebts) > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Debts deducted</dt>
            <dd className="tabular-nums text-slate-900">−{naira(result.deductedDebts)}</dd>
          </div>
        )}
      </dl>

      {(counted.length > 0 || (debts && Number(debts.value) > 0)) && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-primary-700">How we worked it out</summary>
          <ul className="mt-2 space-y-2">
            {[...counted, ...(debts && Number(debts.value) > 0 ? [debts] : [])].map((line, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className={line.counted ? "text-slate-700" : "text-slate-400"}>{line.note}</span>
                <span className={`shrink-0 tabular-nums ${line.counted ? "text-slate-900" : "text-slate-400 line-through"}`}>
                  {naira(line.value)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
