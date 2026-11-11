"use client";

// Zakah's two staff-controlled inputs. Neither takes effect from here:
// a new ruleset version goes live only when a Shariah board member
// approves its zakah.ruleset_approve proposal, and new metal prices only
// when a Compliance officer approves zakah.metal_price_set — both on the
// Approvals queue. This page drafts rulesets and proposes both.
import { useCallback, useEffect, useState } from "react";
import { draftRulesets, priceFreshness, type ZakahRulings } from "@birr/zakah";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { ZakahMetalPriceRow, ZakahRulesetRow } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconShieldCheck,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../_components/ProposeGovernedAction";

const MADHHAB_LABELS: Record<ZakahRulesetRow["madhhab"], string> = {
  maliki: "Maliki",
  hanafi: "Hanafi",
  shafii: "Shafi'i",
  hanbali: "Hanbali",
};

const STATUS_TONE = { draft: "warning", approved: "success", superseded: "neutral" } as const;
const FRESHNESS_TONE = { fresh: "success", stale: "warning", expired: "danger" } as const;

function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function describeRulings(r: ZakahRulings): string {
  const nisab = r.nisabBasis === "lower_of" ? "lower of gold or silver" : r.nisabBasis;
  return [
    `Personal jewellery ${r.personalJewellery}`,
    r.debts === "deduct" ? "debts deducted" : "debts not deducted",
    `nisab by ${nisab} (${r.nisabGoldGrams}g gold / ${r.nisabSilverGrams}g silver)`,
  ].join(" · ");
}

export default function ZakahPage() {
  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Zakah</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            The metal prices that set the nisab in Naira, and the madhhab rulings the zakah calculator applies.
          </p>
        </div>
      </header>
      <MetalPricesSection />
      <RulesetsSection />
    </div>
  );
}

function MetalPricesSection() {
  const { can } = useStaffSession();
  const canPropose = can("zakah.metal_price_set");
  const [prices, setPrices] = useState<ZakahMetalPriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<ZakahMetalPriceRow[]>("/zakah/metal-prices")
      .then(setPrices)
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  const current = prices?.[0];
  const freshness = current ? priceFreshness(current.asOf.slice(0, 10), lagosToday()) : null;

  return (
    <section className="mb-10">
      <SectionHeader
        title="Metal prices"
        description="Naira per gram of pure metal. Payers are warned once prices are over 7 days old, and get no figure at all after 31. Investment Committee proposes; Compliance approves."
        actionLabel={canPropose ? (showForm ? "Cancel" : "Propose new prices") : undefined}
        onAction={canPropose ? () => setShowForm((v) => !v) : undefined}
      />

      {canPropose && showForm && (
        <MetalPriceForm
          current={current}
          onProposed={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load metal prices" className="mb-4">
          {error}
        </Alert>
      )}
      {!error && prices === null && <RowsSkeleton columns={4} />}
      {!error && prices !== null && prices.length === 0 && (
        <EmptyState
          title="No prices approved yet"
          description="The zakah calculator can't give anyone a figure until the first gold and silver prices are approved."
        />
      )}
      {current && freshness && (
        <p className="mb-3 flex items-center gap-2 text-sm text-slate-600">
          Current prices are from {formatDate(current.asOf)} ({freshness.ageDays} day{freshness.ageDays === 1 ? "" : "s"} old)
          <Badge tone={FRESHNESS_TONE[freshness.status]}>{freshness.status}</Badge>
        </p>
      )}
      {prices !== null && prices.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>As of</TableHeaderCell>
              <TableHeaderCell>Gold / g</TableHeaderCell>
              <TableHeaderCell>Silver / g</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {prices.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-slate-900">{formatDate(p.asOf)}</TableCell>
                <TableCell>{formatMoney(p.goldPerGram, "NGN")}</TableCell>
                <TableCell>{formatMoney(p.silverPerGram, "NGN")}</TableCell>
                <TableCell className="text-slate-500">{p.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function MetalPriceForm({ current, onProposed }: { current?: ZakahMetalPriceRow; onProposed: () => void }) {
  const [goldPerGram, setGold] = useState("");
  const [silverPerGram, setSilver] = useState("");
  const [asOf, setAsOf] = useState(lagosToday());
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "zakah.metal_price_set", payload: { goldPerGram, silverPerGram, asOf, source } }),
      });
      onProposed();
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't propose these prices">
          {error}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor="zakah-gold" className="text-sm font-medium text-slate-700">Gold, ₦ per gram</label>
          <Input id="zakah-gold" required inputMode="decimal" pattern="\d+(\.\d+)?" placeholder={current?.goldPerGram ?? "e.g. 150000"} value={goldPerGram} onChange={(e) => setGold(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="zakah-silver" className="text-sm font-medium text-slate-700">Silver, ₦ per gram</label>
          <Input id="zakah-silver" required inputMode="decimal" pattern="\d+(\.\d+)?" placeholder={current?.silverPerGram ?? "e.g. 2000"} value={silverPerGram} onChange={(e) => setSilver(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="zakah-asof" className="text-sm font-medium text-slate-700">Prices as of</label>
          <Input id="zakah-asof" required type="date" max={lagosToday()} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="zakah-source" className="text-sm font-medium text-slate-700">Source</label>
          <Input id="zakah-source" required maxLength={200} placeholder="Where these prices came from" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-slate-500">Use the price of pure (24k) gold and pure silver. A Compliance officer approves before payers see it.</p>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Proposing…" : "Propose for approval"}
      </Button>
    </form>
  );
}

function RulesetsSection() {
  const { can } = useStaffSession();
  const canDraft = can("zakah.ruleset_draft");
  const canPropose = can("zakah.ruleset_approve");
  const [rulesets, setRulesets] = useState<ZakahRulesetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetchJson<ZakahRulesetRow[]>("/zakah/rulesets")
      .then(setRulesets)
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  return (
    <section>
      <SectionHeader
        title="Rulesets"
        description="Each version is drafted by a Mutawalli Officer from the Shariah board's position and goes live only once a Shariah board member approves it. An approved version is never edited — changes are a new version."
        actionLabel={canDraft ? (showForm ? "Cancel" : "Draft a ruleset") : undefined}
        onAction={canDraft ? () => setShowForm((v) => !v) : undefined}
      />

      {canDraft && showForm && (
        <RulesetForm
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load rulesets" className="mb-4">
          {error}
        </Alert>
      )}
      {!error && rulesets === null && <RowsSkeleton columns={4} />}
      {!error && rulesets !== null && rulesets.length === 0 && (
        <EmptyState
          title="No rulesets yet"
          description="Draft one per madhhab the calculator should offer. The form starts from Birr's draft positions for the Shariah board to review."
        />
      )}
      {rulesets !== null && rulesets.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Ruleset</TableHeaderCell>
              <TableHeaderCell>Rulings</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rulesets.map((r) =>
              editingId === r.id ? (
                <TableRow key={r.id}>
                  <TableCell colSpan={4}>
                    <RulesetForm
                      existing={r}
                      onSaved={() => {
                        setEditingId(null);
                        load();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">
                      {r.label} <span className="font-normal text-slate-500">v{r.version}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {MADHHAB_LABELS[r.madhhab]} · {r.key}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md text-sm text-slate-600">{describeRulings(r.rulings)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.approvedAt && <div className="mt-1 text-xs text-slate-500">{formatDate(r.approvedAt)}</div>}
                  </TableCell>
                  <TableCell>
                    {r.status === "draft" && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canDraft && (
                          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setEditingId(r.id)}>
                            Edit
                          </Button>
                        )}
                        {canPropose && (
                          <ProposeGovernedActionButton
                            permissionKey="zakah.ruleset_approve"
                            payload={{ rulesetId: r.id, label: r.label, rulings: r.rulings }}
                            label="Propose for Shariah approval"
                            onProposed={load}
                          />
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function RulesetForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: ZakahRulesetRow;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [madhhab, setMadhhab] = useState<ZakahRulesetRow["madhhab"]>(existing?.madhhab ?? "maliki");
  const [key, setKey] = useState(existing?.key ?? "maliki");
  const [label, setLabel] = useState(existing?.label ?? MADHHAB_LABELS.maliki);
  const [rulings, setRulings] = useState<ZakahRulings>(existing?.rulings ?? draftRulesets.maliki.rulings);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new draft starts from the bundled position for its madhhab.
  function chooseMadhhab(next: ZakahRulesetRow["madhhab"]) {
    setMadhhab(next);
    setKey(next);
    setLabel(MADHHAB_LABELS[next]);
    setRulings(draftRulesets[next].rulings);
  }
  const set = <K extends keyof ZakahRulings>(field: K, value: ZakahRulings[K]) => setRulings((r) => ({ ...r, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (existing) {
        await apiFetchJson(`/zakah/rulesets/${existing.id}`, { method: "PATCH", body: JSON.stringify({ label, rulings }) });
      } else {
        await apiFetchJson("/zakah/rulesets", { method: "POST", body: JSON.stringify({ key, madhhab, label, rulings }) });
      }
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't save this ruleset">
          {error}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="ruleset-madhhab" className="text-sm font-medium text-slate-700">Madhhab</label>
          <Select id="ruleset-madhhab" disabled={!!existing} value={madhhab} onChange={(e) => chooseMadhhab(e.target.value as ZakahRulesetRow["madhhab"])}>
            {Object.entries(MADHHAB_LABELS).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ruleset-key" className="text-sm font-medium text-slate-700">Key</label>
          <Input id="ruleset-key" required disabled={!!existing} pattern="[a-z0-9][a-z0-9-]{1,48}" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ruleset-label" className="text-sm font-medium text-slate-700">Label shown to payers</label>
          <Input id="ruleset-label" required maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ruleset-jewellery" className="text-sm font-medium text-slate-700">Personal jewellery</label>
          <Select id="ruleset-jewellery" value={rulings.personalJewellery} onChange={(e) => set("personalJewellery", e.target.value as ZakahRulings["personalJewellery"])}>
            <option value="exempt">Exempt</option>
            <option value="zakatable">Zakatable</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ruleset-debts" className="text-sm font-medium text-slate-700">Debts due now</label>
          <Select id="ruleset-debts" value={rulings.debts} onChange={(e) => set("debts", e.target.value as ZakahRulings["debts"])}>
            <option value="deduct">Deducted</option>
            <option value="none">Not deducted</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ruleset-nisab" className="text-sm font-medium text-slate-700">Nisab basis</label>
          <Select id="ruleset-nisab" value={rulings.nisabBasis} onChange={(e) => set("nisabBasis", e.target.value as ZakahRulings["nisabBasis"])}>
            <option value="gold">Gold</option>
            <option value="silver">Silver</option>
            <option value="lower_of">Lower of gold or silver</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ruleset-gold-grams" className="text-sm font-medium text-slate-700">Nisab, grams of gold</label>
          <Input id="ruleset-gold-grams" required inputMode="decimal" pattern="\d+(\.\d+)?" value={rulings.nisabGoldGrams} onChange={(e) => set("nisabGoldGrams", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ruleset-silver-grams" className="text-sm font-medium text-slate-700">Nisab, grams of silver</label>
          <Input id="ruleset-silver-grams" required inputMode="decimal" pattern="\d+(\.\d+)?" value={rulings.nisabSilverGrams} onChange={(e) => set("nisabSilverGrams", e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        The nisab basis decides who owes zakah at all: a gold-based nisab is roughly ten times a silver-based one in Naira.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : existing ? "Save draft" : "Create draft"}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
