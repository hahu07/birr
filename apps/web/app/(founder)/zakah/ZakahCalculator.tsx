"use client";

// The calculator itself — runs entirely in the browser through
// @birr/zakah, the same engine the backend and the future mobile app use.
// Nothing the visitor types is sent anywhere: the page only downloads the
// approved rulesets and today's prices (see page.tsx).
import { useMemo, useState, type ReactNode } from "react";
import {
  calculateZakah,
  karatToPurity,
  PAYER_DEFAULT_NISAB_BASIS,
  PricesExpiredError,
  ZakahInputError,
  type MetalHolding,
  type MetalPrices,
  type ZakahResult,
  type ZakahRuleset,
} from "@birr/zakah";
import { Alert, Button, IconCheckCircle, IconPlus, Input, Select } from "@birr/ui";
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

/** The four schools, in the order they're offered (Maliki first: most payers in Nigeria follow it). */
const SCHOOLS: { madhhab: ZakahRuleset["madhhab"]; name: string }[] = [
  { madhhab: "maliki", name: "Maliki" },
  { madhhab: "hanafi", name: "Hanafi" },
  { madhhab: "shafii", name: "Shafi'i" },
  { madhhab: "hanbali", name: "Hanbali" },
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
  // Gold or silver nisab, where the ruleset lets the payer choose (2026-11-16).
  const [nisabChoice, setNisabChoice] = useState<"gold" | "silver">(PAYER_DEFAULT_NISAB_BASIS);

  const ruleset = rulesets.find((r) => r.id === rulesetId) ?? rulesets[0];
  const payerChooses = ruleset.rulings.payerChoosesNisab;

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
        { today, ...(payerChooses && { nisabBasis: nisabChoice }) },
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
  }, [amounts, metals, ruleset, prices, today, payerChooses, nisabChoice]);

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
    <>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="space-y-5">
          <Step number={1} title="Your school of thought" description="The schools differ on a few points, such as worn jewellery and debts.">
            <SchoolPicker rulesets={rulesets} selectedId={ruleset.id} onSelect={setRulesetId} />
          </Step>

          <Step number={2} title="What you own" description="Today's value of each. Leave blank anything that doesn't apply.">
            <div className="space-y-5">
              <AmountField id="cash" label={FIELD_LABELS.cash} hint="Including savings and mobile-money wallets." value={amounts.cash} onChange={(v) => setAmount("cash", v)} />
              <AmountField id="tradeGoods" label={FIELD_LABELS.tradeGoods} hint="What your stock would sell for today." value={amounts.tradeGoods} onChange={(v) => setAmount("tradeGoods", v)} />
              <AmountField id="receivables" label={FIELD_LABELS.receivables} hint="Only money you expect to be paid back." value={amounts.receivables} onChange={(v) => setAmount("receivables", v)} />
            </div>
          </Step>

          <Step number={3} title="Gold and silver" description="Jewellery, coins or bars, by weight. We value them at today's approved prices.">
            <div className="space-y-3">
              {metals.map((row, i) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span
                        aria-hidden="true"
                        className={`h-2.5 w-2.5 rounded-full ${row.metal === "gold" ? "bg-amber-400" : "bg-slate-400"}`}
                      />
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
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-primary-700"
                      checked={row.personalUse}
                      onChange={(e) => updateMetal(row.id, { personalUse: e.target.checked })}
                    />
                    <span>I wear this as jewellery (not kept as savings)</span>
                  </label>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => addMetal("gold")} className="gap-1.5">
                  <IconPlus className="h-4 w-4" />
                  Add gold
                </Button>
                <Button type="button" variant="secondary" onClick={() => addMetal("silver")} className="gap-1.5">
                  <IconPlus className="h-4 w-4" />
                  Add silver
                </Button>
              </div>
            </div>
          </Step>

          <Step number={4} title="What you owe" description="Only what's due now, such as this month's rent — not the whole of a long loan.">
            <AmountField
              id="debtsDueNow"
              label={FIELD_LABELS.debtsDueNow}
              hint={ruleset.rulings.debts === "none" ? `Under the ${ruleset.label} ruleset, debts don't reduce zakah.` : "Deducted from what you own."}
              value={amounts.debtsDueNow}
              onChange={(v) => setAmount("debtsDueNow", v)}
            />
          </Step>

          <Step number={5} title="A full lunar year" description="Zakah is only due on wealth you've owned for one Islamic (hijri) year, called the hawl.">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700 transition-colors hover:border-slate-300 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50/70">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-primary-700" checked={heldAYear} onChange={(e) => setHeldAYear(e.target.checked)} />
              <span>
                <span className="font-medium text-slate-900">I&apos;ve held this wealth for a full lunar year.</span> If not, no zakah is due on
                it yet.
              </span>
            </label>
          </Step>
        </div>

        <ResultPanel
          outcome={outcome}
          heldAYear={heldAYear}
          ruleset={ruleset}
          prices={prices}
          paymentTerms={paymentTerms}
          nisabChoice={payerChooses ? { value: nisabChoice, onChange: setNisabChoice } : null}
        />
      </div>

      <MobileSummary outcome={outcome} heldAYear={heldAYear} />
    </>
  );
}

function Step({ number, title, description, children }: { number: number; title: string; description: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700 ring-1 ring-primary-100"
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      {/* Full width on phones; lined up under the title on wider screens. */}
      <div className="mt-4 sm:pl-[2.875rem]">{children}</div>
    </fieldset>
  );
}

/**
 * One card per school. What each card says about jewellery and debts is
 * read from that school's approved rulings, never written here. A school
 * with no approved ruleset is shown but can't be chosen; one with more
 * than one (e.g. a gold-nisab variant) offers them below the cards.
 */
function SchoolPicker({ rulesets, selectedId, onSelect }: { rulesets: ZakahRuleset[]; selectedId: string; onSelect: (id: string) => void }) {
  const selected = rulesets.find((r) => r.id === selectedId) ?? rulesets[0];
  const sameSchool = rulesets.filter((r) => r.madhhab === selected.madhhab);
  return (
    <div>
      <div role="radiogroup" aria-label="School of thought" className="grid gap-2.5 sm:grid-cols-2">
        {SCHOOLS.map((school) => {
          const options = rulesets.filter((r) => r.madhhab === school.madhhab);
          const first = options[0];
          const checked = selected.madhhab === school.madhhab;
          return (
            <label
              key={school.madhhab}
              className={`relative flex rounded-xl border p-3.5 transition-colors ${
                !first
                  ? "cursor-not-allowed border-dashed border-slate-200 bg-slate-50/50 opacity-70"
                  : checked
                    ? "cursor-pointer border-primary-500 bg-primary-50/70 ring-1 ring-primary-500"
                    : "cursor-pointer border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="zakah-school"
                value={school.madhhab}
                className="sr-only"
                checked={checked}
                disabled={!first}
                onChange={() => first && onSelect(first.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{school.name}</span>
                  {checked && <IconCheckCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-primary-600" />}
                </span>
                {first ? (
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    Worn jewellery {first.rulings.personalJewellery === "zakatable" ? "counted" : "not counted"} · Debts{" "}
                    {first.rulings.debts === "deduct" ? "deducted" : "not deducted"}
                  </span>
                ) : (
                  <span className="mt-1 block text-xs text-slate-500">Awaiting Shariah Board approval</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {sameSchool.length > 1 && (
        <div className="mt-3">
          <label htmlFor="zakah-ruleset" className="mb-1.5 block text-sm text-slate-700">
            Which {SCHOOLS.find((s) => s.madhhab === selected.madhhab)?.name} ruling set
          </label>
          <Select id="zakah-ruleset" className="w-full sm:w-80" value={selected.id} onChange={(e) => onSelect(e.target.value)}>
            {sameSchool.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} (version {r.version})
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}

function AmountField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  // Read back what was typed as money, so "3000000" is easy to check.
  const parsed = normaliseAmount(value);
  const readBack = value.trim() !== "" && /^\d+(\.\d+)?$/.test(parsed) && Number(parsed) > 0 ? naira(parsed) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`zakah-${id}`} className="block text-sm font-medium text-slate-800">
          {label}
        </label>
        {readBack && (
          <span aria-hidden="true" className="text-xs tabular-nums text-slate-500">
            {readBack}
          </span>
        )}
      </div>
      <p id={`zakah-${id}-hint`} className="mb-1.5 mt-0.5 text-xs text-slate-500">
        {hint}
      </p>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-medium text-slate-400">₦</span>
        <Input
          id={`zakah-${id}`}
          aria-describedby={`zakah-${id}-hint`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          className="h-11 pl-8 text-base tabular-nums"
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
  nisabChoice,
}: {
  outcome: Outcome;
  heldAYear: boolean;
  ruleset: ZakahRuleset;
  prices: MetalPrices;
  paymentTerms: ZakahPaymentTerms | null;
  /** Set when the ruleset lets the payer choose a gold or silver nisab. */
  nisabChoice: { value: "gold" | "silver"; onChange: (v: "gold" | "silver") => void } | null;
}) {
  return (
    <aside id="zakah-result" className="scroll-mt-24 lg:sticky lg:top-24">
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-primary-700 via-primary-500 to-accent-500" />
        <div className="p-6">
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
          {nisabChoice && <NisabChoice ruleset={ruleset} prices={prices} choice={nisabChoice} />}
          {outcome.kind === "result" && <ResultDetails result={outcome.result} heldAYear={heldAYear} />}
          {outcome.kind === "result" && heldAYear && outcome.result.meetsNisab && (
            paymentTerms?.available ? (
              // Keyed by the figure, so the amount resets when the calculation changes.
              <PayZakahForm
                key={outcome.result.zakahDue}
                zakahDue={outcome.result.zakahDue}
                ruleset={{ key: outcome.result.ruleset.id, version: outcome.result.ruleset.version }}
                nisabBasis={nisabChoice?.value}
                terms={paymentTerms}
              />
            ) : (
              <p className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-600">Paying your zakah through Birr opens soon.</p>
            )
          )}
        </div>
        <p className="border-t border-slate-100 bg-slate-50/70 px-6 py-4 text-xs leading-relaxed text-slate-500">
          Uses the {ruleset.label} ruleset (version {ruleset.version}), approved by Birr&apos;s Shariah Supervisory Board, and gold
          and silver prices from {formatDate(prices.asOf)} ({prices.source}). Your figures stay on this device — nothing you type is
          sent to Birr. This is a calculation tool, not a fatwa; for unusual situations, ask a scholar you trust.
        </p>
      </div>
    </aside>
  );
}

/**
 * Gold or silver nisab, for a ruleset that lets the payer choose. Shows
 * today's figure for each, since the choice moves the threshold about
 * tenfold.
 */
function NisabChoice({
  ruleset,
  prices,
  choice,
}: {
  ruleset: ZakahRuleset;
  prices: MetalPrices;
  choice: { value: "gold" | "silver"; onChange: (v: "gold" | "silver") => void };
}) {
  const value = (metal: "gold" | "silver") =>
    naira(
      String(
        Number(metal === "gold" ? ruleset.rulings.nisabGoldGrams : ruleset.rulings.nisabSilverGrams) *
          Number(metal === "gold" ? prices.goldPerGram : prices.silverPerGram),
      ),
    );
  return (
    <fieldset className="mb-5">
      <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Nisab by</legend>
      <div role="radiogroup" aria-label="Nisab by" className="mt-2 grid grid-cols-2 gap-2">
        {(["silver", "gold"] as const).map((metal) => (
          <label
            key={metal}
            className={`cursor-pointer rounded-xl border px-3 py-2.5 transition-colors ${
              choice.value === metal ? "border-primary-500 bg-primary-50/70 ring-1 ring-primary-500" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input type="radio" name="nisab-basis" value={metal} className="sr-only" checked={choice.value === metal} onChange={() => choice.onChange(metal)} />
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${metal === "gold" ? "bg-amber-400" : "bg-slate-400"}`} />
              {metal === "gold" ? "Gold" : "Silver"}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-slate-500">{value(metal)}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Scholars differ on which metal sets the nisab today. Silver, the lower threshold, means more people pay zakah, which favours those who
        receive it. If unsure, ask your scholar.
      </p>
    </fieldset>
  );
}

/** How far the wealth counted has come towards the nisab, as a share of it (0–1). */
function nisabProgress(result: ZakahResult): number {
  const nisab = Number(result.nisab.value);
  if (!(nisab > 0)) return 0;
  return Math.max(0, Math.min(1, Number(result.netZakatableWealth) / nisab));
}

function ResultDetails({ result, heldAYear }: { result: ZakahResult; heldAYear: boolean }) {
  const counted = result.lines.filter((l) => l.kind !== "debts" && Number(l.value) > 0);
  const debts = result.lines.find((l) => l.kind === "debts");
  const progress = nisabProgress(result);
  const hasWealth = Number(result.netZakatableWealth) > 0;

  return (
    <div>
      {result.priceFreshness.status === "stale" && (
        <Alert tone="warning" title="Prices are over a week old" className="mb-4">
          Gold and silver prices were last updated {result.priceFreshness.ageDays} days ago, so the nisab may have moved since.
        </Alert>
      )}

      <div aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Your zakah</p>
        {!heldAYear ? (
          <p className="mt-2 text-sm text-slate-600">Tick the box confirming you&apos;ve held this wealth for a full lunar year to see what you owe.</p>
        ) : result.meetsNisab ? (
          <>
            <p className="font-display mt-1 text-4xl font-medium tabular-nums tracking-tight text-primary-800">{naira(result.zakahDue)}</p>
            <p className="mt-1 text-sm text-slate-600">2.5% of {naira(result.netZakatableWealth)}</p>
          </>
        ) : (
          <>
            <p className="font-display mt-1 text-4xl font-medium tabular-nums tracking-tight text-slate-900">{naira("0")}</p>
            <p className="mt-1 text-sm text-slate-600">
              {hasWealth ? `Your wealth is below the nisab, so no zakah is due this year.` : "Enter what you own to see your zakah."}
            </p>
          </>
        )}
      </div>

      {hasWealth && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-600">{result.meetsNisab ? "Above the nisab" : "Towards the nisab"}</span>
            <span className="tabular-nums text-slate-500">{Math.round(progress * 100)}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Wealth counted towards the nisab"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${result.meetsNisab ? "bg-gradient-to-r from-primary-600 to-accent-500" : "bg-slate-400"}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}

      <dl className="mt-5 space-y-2.5 border-t border-slate-100 pt-4 text-sm">
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
        <details className="group mt-4 text-sm">
          <summary className="cursor-pointer list-none font-medium text-primary-700 hover:text-primary-800">
            <span className="inline-flex items-center gap-1">
              How we worked it out
              <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                ›
              </span>
            </span>
          </summary>
          <ul className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
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

/**
 * On a phone the result sits below a long form, so a slim bar keeps the
 * figure in view and jumps to the full result. Hidden on wide screens,
 * where the result card stays beside the form.
 */
function MobileSummary({ outcome, heldAYear }: { outcome: Outcome; heldAYear: boolean }) {
  if (outcome.kind !== "result" || !(Number(outcome.result.netZakatableWealth) > 0)) return null;
  const { result } = outcome;
  const figure = !heldAYear ? "Confirm the lunar year" : result.meetsNisab ? naira(result.zakahDue) : "None due";
  return (
    <div aria-hidden="true" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur lg:hidden">
      <a href="#zakah-result" tabIndex={-1} className="mx-auto flex max-w-xl items-center justify-between gap-3">
        <span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your zakah</span>
          <span className="block text-lg font-semibold tabular-nums text-slate-900">{figure}</span>
        </span>
        <span className="rounded-lg bg-primary-700 px-3.5 py-2 text-sm font-semibold text-white">See result</span>
      </a>
    </div>
  );
}
