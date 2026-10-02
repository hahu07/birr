"use client";

// Causes within a Vault — a vault supports as many causes as staff add,
// picked from the same shared CauseCategory catalog the Founder Portal's
// own cause picker uses (app/(founder)/portfolio/[id]/CausesSection.tsx),
// several at once via checkboxes rather than one at a time — plus a
// one-off custom cause for anything genuinely outside that catalog, same
// two-shape convention as WaqfCausesService.create()/selectForFounder().
// Both allocatedAmount and proceedsAllocatedAmount only ever move via a
// governed action here (vault.cause_allocate / vault.proceeds_allocate)
// — there's no Founder to hold a self-service half of that decision for
// a Vault (see VaultCause's own schema comment), so both columns use the
// bespoke propose-with-a-value inline control, same shape as the Waqf
// side's InvestmentChangeAction.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate } from "../../../../lib/format";
import type { CauseCategory, Vault, VaultCause } from "../../../../lib/ops-types";
import { Alert, Button, EmptyState, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

export function VaultCausesSection({
  vaultId,
  vaultType,
  currency,
  additionalCurrencies,
  onChanged,
}: {
  vaultId: string;
  vaultType: Vault["type"];
  currency: string;
  additionalCurrencies: string[];
  onChanged: () => void;
}) {
  const { data: causes, error, reload: load } = useLoadedResource(() => apiFetchJson<VaultCause[]>(`/vaults/${vaultId}/causes`), [vaultId]);
  const [categories, setCategories] = useState<CauseCategory[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  const showProceeds = vaultType === "investment";

  useEffect(() => {
    apiFetchJson<CauseCategory[]>("/cause-categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  return (
    <section>
      <SectionHeader
        title="Causes"
        description="What this vault's contributions support — allocation moves only via a governed approval, decided on the Approval Queue."
        actionLabel={showForm ? "Cancel" : "Add causes"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load causes" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <CauseForm
          vaultId={vaultId}
          categories={categories ?? []}
          alreadyAddedCategoryIds={new Set((causes ?? []).flatMap((c) => (c.causeCategoryId ? [c.causeCategoryId] : [])))}
          onCreated={() => {
            setShowForm(false);
            load();
            onChanged();
          }}
        />
      )}

      {!error && causes === null && <RowsSkeleton columns={showProceeds ? 7 : 6} />}

      {!error && causes !== null && causes.length === 0 && !showForm && (
        <EmptyState title="No causes yet" description="Add one above before publishing this vault." />
      )}

      {!error && causes !== null && causes.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Description</TableHeaderCell>
              <TableHeaderCell>Project plan</TableHeaderCell>
              <TableHeaderCell>Goal ({currency})</TableHeaderCell>
              <TableHeaderCell>Allocated</TableHeaderCell>
              {showProceeds && <TableHeaderCell>Proceeds allocated</TableHeaderCell>}
              <TableHeaderCell className="text-right">Added</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {causes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-slate-900">
                  {c.icon && (
                    <span aria-hidden="true" className="mr-1.5">
                      {c.icon}
                    </span>
                  )}
                  {c.name}
                </TableCell>
                <TableCell className="text-slate-500">{c.description ?? "—"}</TableCell>
                <TableCell className="text-slate-500">
                  <ProjectPlanCell causeId={c.id} value={c.projectPlan} onSaved={load} />
                </TableCell>
                <TableCell className="text-slate-500">
                  <TargetAmountCell causeId={c.id} value={c.targetAmount} onSaved={load} />
                </TableCell>
                <TableCell className="text-slate-500">
                  <AllocationCell
                    label="Set"
                    currency={currency}
                    additionalCurrencies={additionalCurrencies}
                    current={(c.allocations ?? []).map((a) => ({ currency: a.currency, amount: a.allocatedAmount }))}
                    permissionKey="vault.cause_allocate"
                    payload={(allocCurrency, newAllocatedAmount) => ({ vaultCauseId: c.id, currency: allocCurrency, newAllocatedAmount })}
                    onProposed={() => {
                      load();
                      onChanged();
                    }}
                  />
                </TableCell>
                {showProceeds && (
                  <TableCell className="text-slate-500">
                    <AllocationCell
                      label="Set"
                      currency={currency}
                      additionalCurrencies={additionalCurrencies}
                      current={(c.allocations ?? []).map((a) => ({ currency: a.currency, amount: a.proceedsAllocatedAmount }))}
                      permissionKey="vault.proceeds_allocate"
                      payload={(allocCurrency, newProceedsAllocatedAmount) => ({
                        vaultCauseId: c.id,
                        currency: allocCurrency,
                        newProceedsAllocatedAmount,
                      })}
                      onProposed={() => {
                        load();
                        onChanged();
                      }}
                    />
                  </TableCell>
                )}
                <TableCell className="text-right text-slate-500">{formatDate(c.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// Governed, value-taking propose control — same shape as the Waqf side's
// InvestmentChangeAction, generalized over which permission/payload it
// proposes since this section needs it twice (corpus vs proceeds
// allocation). Update, 2026-09-15: allocation is now per-currency
// (VaultCauseAllocation) — `current` is every currency this cause has
// an allocation row for, shown as a short list, and the propose form
// picks which currency it's setting (only shown when the vault accepts
// more than one), same acceptedCurrencies-selector shape
// VaultExpensesSection's own form already uses.
function AllocationCell({
  label,
  currency,
  additionalCurrencies,
  current,
  permissionKey,
  payload,
  onProposed,
}: {
  label: string;
  currency: string;
  additionalCurrencies: string[];
  current: { currency: string; amount: string }[];
  permissionKey: string;
  payload: (currency: string, amount: string) => Record<string, unknown>;
  onProposed: () => void;
}) {
  const acceptedCurrencies = [currency, ...additionalCurrencies];
  const [editing, setEditing] = useState(false);
  const [allocCurrency, setAllocCurrency] = useState(currency);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [proposed, setProposed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (proposed) {
    return <span className="text-xs text-slate-500">Pending approval</span>;
  }

  if (!editing) {
    const nonZero = current.filter((a) => Number(a.amount) !== 0);
    return (
      <div className="flex items-center gap-2">
        <span>
          {nonZero.length > 0 ? nonZero.map((a) => `${a.currency} ${formatAmount(a.amount)}`).join(" · ") : "—"}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:underline"
          onClick={() => {
            setAllocCurrency(currency);
            setAmount(current.find((a) => a.currency === currency)?.amount ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          {label}
        </button>
      </div>
    );
  }

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey, payload: payload(allocCurrency, amount) }),
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
        {acceptedCurrencies.length > 1 && (
          <Select
            className="w-20 px-2 py-1.5 text-xs"
            value={allocCurrency}
            onChange={(e) => {
              const next = e.target.value;
              setAllocCurrency(next);
              setAmount(current.find((a) => a.currency === next)?.amount ?? "");
            }}
          >
            {acceptedCurrencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
        <Input
          type="number"
          min="0"
          step="0.01"
          autoFocus
          className="w-28"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
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

// Two ways to add causes, same convention as WaqfCausesService's own
// two-shape create(): pick one or more from the shared catalog (the
// common path — mirrors the Founder Portal's own multi-select cause
// picker, just staff-driven and batched into one "Add" click instead of
// a per-checkbox toggle), or register a one-off custom cause outside the
// catalog for this vault specifically.
function CauseForm({
  vaultId,
  categories,
  alreadyAddedCategoryIds,
  onCreated,
}: {
  vaultId: string;
  categories: CauseCategory[];
  alreadyAddedCategoryIds: Set<string>;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"catalog" | "custom">("catalog");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const availableCategories = categories
    .filter((c) => !alreadyAddedCategoryIds.has(c.id))
    .filter((c) => !query || c.name.toLowerCase().includes(query) || (c.description ?? "").toLowerCase().includes(query));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddSelected() {
    setError(null);
    setSubmitting(true);
    try {
      await Promise.all(
        Array.from(selected).map((causeCategoryId) =>
          apiFetchJson("/vaults/causes", {
            method: "POST",
            body: JSON.stringify({ vaultId, causeCategoryId }),
          }),
        ),
      );
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't add cause(s)">
          {error}
        </Alert>
      )}

      <div className="flex items-center gap-4 border-b border-slate-100 pb-2 text-sm">
        <button
          type="button"
          className={mode === "catalog" ? "font-medium text-primary-700" : "text-slate-500 hover:text-slate-700"}
          onClick={() => setMode("catalog")}
        >
          Pick from catalog
        </button>
        <button
          type="button"
          className={mode === "custom" ? "font-medium text-primary-700" : "text-slate-500 hover:text-slate-700"}
          onClick={() => setMode("custom")}
        >
          Add a custom cause
        </button>
      </div>

      {mode === "catalog" ? (
        <div className="space-y-3">
          {categories.length > 0 && (
            <Input
              placeholder="Search causes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          )}

          {availableCategories.length === 0 ? (
            <p className="text-sm text-slate-500">
              {query ? `No causes match "${search.trim()}".` : "Every catalog cause has already been added to this vault."}
            </p>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {availableCategories.map((category) => (
                <label
                  key={category.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors ${
                    selected.has(category.id) ? "border-primary-200 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(category.id)}
                    onChange={() => toggle(category.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      {category.icon && <span className="mr-1.5">{category.icon}</span>}
                      {category.name}
                    </span>
                    {category.description && <span className="block text-slate-500">{category.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          <Button type="button" disabled={selected.size === 0 || submitting} onClick={handleAddSelected}>
            {submitting ? "Adding…" : selected.size > 0 ? `Add ${selected.size} selected` : "Add selected"}
          </Button>
        </div>
      ) : (
        <CustomCauseForm
          vaultId={vaultId}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}

function CustomCauseForm({ vaultId, onCreated }: { vaultId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectPlan, setProjectPlan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/vaults/causes", {
        method: "POST",
        body: JSON.stringify({ vaultId, name, description: description || undefined, projectPlan: projectPlan || undefined }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-[16rem] flex-[2] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description (optional)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Project plan (optional)</label>
        {/* Cause-specific, unlike the vault's own feasibility report —
            see VaultCause.projectPlan's own schema comment. Public, shown
            to a donor once they pick this specific cause on the
            donation form. */}
        <textarea
          rows={2}
          maxLength={2000}
          placeholder="A brief write-up of how this specific cause's money is actually used — e.g. which partner delivers it, and how."
          value={projectPlan}
          onChange={(e) => setProjectPlan(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Adding…" : "Add"}
      </Button>
      {/* Was set but never rendered — e.g. a duplicate cause name failed silently. */}
      {error && (
        <Alert tone="danger" title="Couldn't add cause">
          {error}
        </Alert>
      )}
    </form>
  );
}

// Plain staff CRUD (PATCH /vaults/causes/:id/project-plan), not a
// governed propose — deliberately a different, simpler interaction
// shape from AllocationCell above, which proposes a governed action.
// Editing descriptive content isn't a fiduciary decision the way moving
// an allocation ceiling is.
function ProjectPlanCell({ causeId, value, onSaved }: { causeId: string; value: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <span className="max-w-xs truncate">{value || "—"}</span>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-primary-700 hover:underline"
          onClick={() => {
            setDraft(value ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          {value ? "Edit" : "Add"}
        </button>
      </div>
    );
  }

  async function handleSave() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/vaults/causes/${causeId}/project-plan`, {
        method: "PATCH",
        body: JSON.stringify({ projectPlan: draft }),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-w-[16rem] space-y-1.5">
      <textarea
        autoFocus
        rows={2}
        maxLength={2000}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      />
      <div className="flex items-center gap-2">
        <Button type="button" disabled={submitting} onClick={handleSave} className="px-2.5 py-1 text-xs">
          {submitting ? "Saving…" : "Save"}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

// Plain staff CRUD (PATCH /vaults/causes/:id/target-amount), same shape
// as ProjectPlanCell above — a display-only donation-page goal, not a
// fiduciary ceiling (that's AllocationCell's governed propose below).
// Clearing the field back to empty sends null, removing the goal
// (and the public progress bar) rather than leaving a stale number.
function TargetAmountCell({ causeId, value, onSaved }: { causeId: string; value: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span>{value ? formatAmount(value) : "—"}</span>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-primary-700 hover:underline"
          onClick={() => {
            setDraft(value ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          {value ? "Edit" : "Set"}
        </button>
      </div>
    );
  }

  async function handleSave() {
    setError(null);
    const trimmed = draft.trim();
    if (trimmed && (Number.isNaN(Number(trimmed)) || Number(trimmed) <= 0)) {
      setError("Enter a positive amount, or leave it blank to clear the goal.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson(`/vaults/causes/${causeId}/target-amount`, {
        method: "PATCH",
        body: JSON.stringify({ targetAmount: trimmed || null }),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-w-[9rem] space-y-1.5">
      <Input
        type="number"
        min="0"
        step="0.01"
        autoFocus
        placeholder="No goal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-28 px-2 py-1.5 text-xs"
      />
      <div className="flex items-center gap-2">
        <Button type="button" disabled={submitting} onClick={handleSave} className="px-2.5 py-1 text-xs">
          {submitting ? "Saving…" : "Save"}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
