"use client";

// Founder-facing self-service cause picker. Causes come from the
// standard catalog Birr's product team maintains (CauseCategory, see
// app/ops/cause-categories) — a Founder checks/unchecks which ones apply
// to their own fund, no staff involvement, no approval gate (matches
// establishment's own self-service posture). A Birr staff member can
// still register a one-off custom cause outside the catalog for this
// specific waqf (app/ops/waqfs/[id]/CausesSection.tsx) — those show
// below, read-only, since they're staff-managed.
//
// Waqf type and Cause are deliberately orthogonal (type = how value is
// held, cause = why it's spent) — see CauseCategory.typicalWaqfTypes'
// own schema comment. The "suggested for [type]" grouping below and the
// single-cause note for Project waqfs are both pure UX nudges: every
// category stays fully visible and pickable regardless of type, and the
// note never blocks a second (or third) selection.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize } from "../../../../lib/format";
import type { CauseCategory, Waqf, WaqfCause } from "../../../../lib/types";
import { Alert, Button, Input, Skeleton } from "@birr/ui";

export function CausesSection({
  waqfId,
  waqfType,
  amountRaised,
  corpusCurrency,
}: {
  waqfId: string;
  waqfType: Waqf["type"];
  // Cause Allocation always draws from the founder's own raised corpus,
  // regardless of waqf type — including an Investment-type waqf, where
  // this is deliberately NOT the same pool as WaqfProceeds (investment
  // returns are tracked separately, purely for staff reporting, and play
  // no role in allocation).
  amountRaised: string;
  corpusCurrency: string | null;
}) {
  const [causes, setCauses] = useState<WaqfCause[] | null>(null);
  const [categories, setCategories] = useState<CauseCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [suggestState, setSuggestState] = useState<"idle" | "form" | "submitted">("idle");
  const [allocatingCauseId, setAllocatingCauseId] = useState<string | null>(null);
  // Set only when unchecking a cause that already has beneficiaries or
  // distributions against it — asks for a second click instead of
  // unselecting immediately, since that history stops being offered for
  // new beneficiaries/distributions the moment this cause is off (see
  // toggle() below; the history itself is never lost, just no longer
  // an option going forward).
  const [confirmUnselect, setConfirmUnselect] = useState<{ category: CauseCategory; cause: WaqfCause } | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`),
      apiFetchJson<CauseCategory[]>("/cause-categories"),
    ])
      .then(([causesData, categoriesData]) => {
        setCauses(causesData);
        setCategories(categoriesData);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  const pool = Number(amountRaised);
  const catalogCauses = (causes ?? []).filter((c) => c.causeCategoryId);
  const totalAllocated = catalogCauses.reduce((sum, c) => sum + Number(c.allocatedAmount ?? 0), 0);
  const availableToAllocate = pool - totalAllocated;

  async function allocate(cause: WaqfCause, amount: string) {
    setActionError(null);
    try {
      await apiFetchJson(`/waqf-causes/${cause.id}/allocate`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      setAllocatingCauseId(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function toggle(category: CauseCategory) {
    const selected = causes?.find((c) => c.causeCategoryId === category.id);
    if (selected) {
      const inUse = (selected._count?.beneficiaries ?? 0) > 0 || (selected._count?.distributions ?? 0) > 0;
      if (inUse && confirmUnselect?.cause.id !== selected.id) {
        setConfirmUnselect({ category, cause: selected });
        return;
      }
    }
    setConfirmUnselect(null);
    setActionError(null);
    setPendingCategoryId(category.id);
    try {
      if (selected) {
        await apiFetchJson(`/waqf-causes/${selected.id}/unselect`, { method: "POST" });
      } else {
        await apiFetchJson("/waqf-causes/select", {
          method: "POST",
          body: JSON.stringify({ waqfId, causeCategoryId: category.id }),
        });
      }
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingCategoryId(null);
    }
  }

  const customCauses = causes?.filter((c) => !c.causeCategoryId) ?? [];

  // Filtered before the suggested/other split so both groups shrink
  // together — a search match in "Other causes" shouldn't require also
  // matching something in "Suggested" to show up.
  const query = search.trim().toLowerCase();
  const filteredCategories =
    categories?.filter(
      (c) => !query || c.name.toLowerCase().includes(query) || (c.description ?? "").toLowerCase().includes(query),
    ) ?? [];
  const suggested = filteredCategories.filter((c) => c.typicalWaqfTypes.includes(waqfType));
  const suggestedIds = new Set(suggested.map((c) => c.id));
  const otherCategories = filteredCategories.filter((c) => !suggestedIds.has(c.id));
  const hasSplit = categories !== null && suggested.length > 0 && otherCategories.length > 0;

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Causes</p>
          <p className="text-sm text-slate-500">Pick which of Birr's standard causes apply to this fund.</p>
        </div>
        {suggestState === "idle" && (
          <Button variant="secondary" className="shrink-0" onClick={() => setSuggestState("form")}>
            Suggest a cause
          </Button>
        )}
      </div>

      {suggestState === "submitted" && (
        <Alert tone="success" title="Thanks for the suggestion" className="mb-4">
          Birr's product team will review it — if approved, it joins the standard catalog for every fund, not just
          this one.
        </Alert>
      )}

      {suggestState === "form" && (
        <SuggestCauseFormPanel
          waqfId={waqfId}
          onSubmitted={() => setSuggestState("submitted")}
          onCancel={() => setSuggestState("idle")}
        />
      )}

      {(error || actionError) && (
        <Alert tone="danger" title="Something went wrong">
          {error ?? actionError}
        </Alert>
      )}

      {confirmUnselect && (
        <Alert tone="warning" title={`Remove "${confirmUnselect.category.name}" from this fund?`} className="mb-3">
          <p>
            {confirmUnselect.cause._count?.beneficiaries ? (
              <>
                {confirmUnselect.cause._count.beneficiaries} beneficiar
                {confirmUnselect.cause._count.beneficiaries === 1 ? "y is" : "ies are"} currently linked to this
                cause
                {confirmUnselect.cause._count?.distributions ? ", and " : ". "}
              </>
            ) : null}
            {confirmUnselect.cause._count?.distributions ? (
              <>
                {confirmUnselect.cause._count.distributions} distribution
                {confirmUnselect.cause._count.distributions === 1 ? " has" : "s have"} already been recorded against
                it.{" "}
              </>
            ) : null}
            That history is kept and stays visible to Birr — nothing is deleted. But once removed, this cause won't
            be offered for any new beneficiaries or distributions on this fund until you select it again.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="danger"
              className="px-3 py-1.5 text-xs"
              onClick={() => toggle(confirmUnselect.category)}
            >
              Remove it anyway
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => setConfirmUnselect(null)}
            >
              Keep it
            </Button>
          </div>
        </Alert>
      )}

      {waqfType === "project" && causes !== null && causes.length > 1 && (
        <Alert tone="warning" title="More than one cause on a Project fund" className="mb-3">
          Project waqfs are usually tied to a single cause — this one has {causes.length}. That's fine if it
          genuinely fits, just flagging it in case it doesn't.
        </Alert>
      )}

      {!error && (causes === null || categories === null) && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {!error && causes !== null && categories !== null && (
        <div className="space-y-4">
          {categories.length > 0 && (
            <Input
              placeholder="Search causes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          )}

          {filteredCategories.length === 0 && query && (
            <p className="text-sm text-slate-500">No causes match "{search.trim()}".</p>
          )}

          {hasSplit && (
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Suggested for {humanize(waqfType)} funds
            </p>
          )}
          <CauseCheckboxList
            categories={suggested.length > 0 ? suggested : filteredCategories}
            causes={causes}
            pendingCategoryId={pendingCategoryId}
            onToggle={toggle}
          />

          {hasSplit && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Other causes</p>
              <CauseCheckboxList
                categories={otherCategories}
                causes={causes}
                pendingCategoryId={pendingCategoryId}
                onToggle={toggle}
              />
            </>
          )}
        </div>
      )}

      {!error && catalogCauses.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Allocation</p>
          <p className="mb-3 text-sm text-slate-500">
            How much of this fund's raised funds goes to each cause — and from there, to that cause's beneficiaries.
          </p>

          {pool === 0 ? (
            <p className="text-sm text-slate-500">Nothing raised yet — nothing to allocate until this fund receives a contribution.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                {corpusCurrency} {formatAmount(availableToAllocate)} of {corpusCurrency} {formatAmount(pool)}{" "}
                unallocated.
              </p>
              <div className="space-y-2">
                {catalogCauses.map((cause) => (
                  <div key={cause.id} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{cause.name}</p>
                        <p className="text-sm text-slate-500">
                          {cause.allocatedAmount !== null
                            ? `${corpusCurrency} ${formatAmount(cause.allocatedAmount)} allocated`
                            : "Not allocated yet"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="shrink-0 px-3 py-1.5 text-xs"
                        onClick={() => setAllocatingCauseId((v) => (v === cause.id ? null : cause.id))}
                      >
                        {allocatingCauseId === cause.id ? "Cancel" : "Allocate"}
                      </Button>
                    </div>
                    {allocatingCauseId === cause.id && (
                      <AllocateForm
                        cause={cause}
                        maxAvailable={availableToAllocate + Number(cause.allocatedAmount ?? 0)}
                        currency={corpusCurrency}
                        onSubmit={(amount) => allocate(cause, amount)}
                        onCancel={() => setAllocatingCauseId(null)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!error && customCauses.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            Added by Birr staff for this fund
          </p>
          <div className="space-y-1.5">
            {customCauses.map((cause) => (
              <div key={cause.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <span className="font-medium text-slate-900">{cause.name}</span>
                {cause.description && <span className="block text-slate-500">{cause.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Founder-Portal self-service — asks Birr's product team to add
 * something new to the standard catalog (only staff can add directly,
 * see app/ops/cause-categories). Deliberately minimal: no list of past
 * suggestions here, just propose-and-confirm — the review queue itself
 * lives entirely on the Ops side, matching CLAUDE.md's "Founder-facing
 * surfaces stay lightweight" instruction. Trigger button lives in the
 * parent's header row (a real Button, not a subtle text link); this
 * panel is the expanded form itself, rendered full-width below it.
 */
function SuggestCauseFormPanel({
  waqfId,
  onSubmitted,
  onCancel,
}: {
  waqfId: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson("/cause-category-suggestions", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, waqfId }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't submit suggestion">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Cause name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="min-w-[16rem] flex-[2] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Why this cause (optional)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Inline amount entry for one cause's allocation — `maxAvailable` already
 * folds this cause's own current allocation back in (see the call site),
 * so raising or lowering the number both work against the same ceiling:
 * the waqf's total pool minus every *other* cause's allocation.
 */
function AllocateForm({
  cause,
  maxAvailable,
  currency,
  onSubmit,
  onCancel,
}: {
  cause: WaqfCause;
  maxAvailable: number;
  currency: string | null;
  onSubmit: (amount: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(cause.allocatedAmount ?? "");
  const [submitting, setSubmitting] = useState(false);

  const parsed = Number(amount);
  const isValid = amount.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0 && parsed <= maxAvailable;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    await onSubmit(amount);
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
      <div className="w-40 space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Amount ({currency})</label>
        <Input type="number" min="0" max={maxAvailable} step="0.01" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        {amount.trim().length > 0 && !isValid && (
          <p className="text-xs text-red-600">Up to {maxAvailable.toLocaleString()} available.</p>
        )}
      </div>
      <Button type="submit" disabled={!isValid || submitting} className="px-3 py-1.5 text-xs">
        {submitting ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="secondary" onClick={onCancel} className="px-3 py-1.5 text-xs">
        Cancel
      </Button>
    </form>
  );
}

interface CauseTreeNode {
  category: CauseCategory;
  children: CauseTreeNode[];
}

// Arbitrary depth (see CauseCategory.parentId's schema comment). Only
// categories actually present in *this* slice nest under their parent; a
// child whose parent got filtered out (by search, or landed in the other
// suggested/other group) renders standalone at the top instead of
// disappearing. `seen` guards against an unexpected cycle in the data.
function buildCauseTree(categories: CauseCategory[]): CauseTreeNode[] {
  const ids = new Set(categories.map((c) => c.id));
  const byParent = new Map<string, CauseCategory[]>();
  for (const c of categories) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const seen = new Set<string>();
  function build(parentKey: string): CauseTreeNode[] {
    return (byParent.get(parentKey) ?? [])
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      })
      .map((c) => ({ category: c, children: build(c.id) }));
  }
  return build("__root__");
}

function CauseCheckboxList({
  categories,
  causes,
  pendingCategoryId,
  onToggle,
}: {
  categories: CauseCategory[];
  causes: WaqfCause[];
  pendingCategoryId: string | null;
  onToggle: (category: CauseCategory) => void;
}) {
  return (
    <div className="space-y-1.5">
      {buildCauseTree(categories).map((node) => (
        <CauseTreeNode key={node.category.id} node={node} causes={causes} pendingCategoryId={pendingCategoryId} onToggle={onToggle} />
      ))}
    </div>
  );
}

// A category with children is just a non-selectable grouping label (same
// rule as the schema comment on CauseCategory.parentId); one with none
// renders as a checkbox exactly as every category did before hierarchy
// existed. Nesting the same component under itself is what gives deeper
// levels their own indentation, for free, at any depth.
function CauseTreeNode({
  node,
  causes,
  pendingCategoryId,
  onToggle,
}: {
  node: CauseTreeNode;
  causes: WaqfCause[];
  pendingCategoryId: string | null;
  onToggle: (category: CauseCategory) => void;
}) {
  if (node.children.length === 0) {
    return (
      <CauseCheckbox category={node.category} causes={causes} pendingCategoryId={pendingCategoryId} onToggle={onToggle} />
    );
  }
  return (
    <div>
      <p className="flex items-center gap-1.5 px-1 py-1 text-sm font-medium text-slate-700">
        {node.category.icon && <span>{node.category.icon}</span>}
        {node.category.name}
      </p>
      <div className="ml-4 space-y-1.5 border-l border-slate-200 pl-3">
        {node.children.map((child) => (
          <CauseTreeNode key={child.category.id} node={child} causes={causes} pendingCategoryId={pendingCategoryId} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

function CauseCheckbox({
  category,
  causes,
  pendingCategoryId,
  onToggle,
}: {
  category: CauseCategory;
  causes: WaqfCause[];
  pendingCategoryId: string | null;
  onToggle: (category: CauseCategory) => void;
}) {
  const isSelected = causes.some((c) => c.causeCategoryId === category.id);
  const isPending = pendingCategoryId === category.id;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors ${
        isSelected ? "border-primary-200 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"
      } ${isPending ? "opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        disabled={isPending}
        onChange={() => onToggle(category)}
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
  );
}
