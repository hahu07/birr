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
import type { CauseAllocationSummary, CauseCategory, Waqf, WaqfCause } from "../../../../lib/types";
import { Alert, Button, Input, Select, Skeleton } from "@birr/ui";

// Changing an allocation that's already set is guided (owner's decisions,
// 2026-11-16): a review step before it's saved, a "Move" option that
// takes from one cause and adds to another in one step, and a written
// reason whenever money comes off a cause (lowering, moving, removing),
// which the fund's Mutawalli Officer is told about. On Asset and Project
// funds a cause can't go below what's already been committed to it.
const REASON_MIN = 5;
const textareaClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

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
  const [panel, setPanel] = useState<{ causeId: string; mode: "allocate" | "move" } | null>(null);
  const [summary, setSummary] = useState<CauseAllocationSummary | null>(null);
  const [unselectReason, setUnselectReason] = useState("");
  // Set only when unchecking a cause that already has beneficiaries,
  // distributions, a pending nomination, or a nonzero allocation against
  // it — asks for a second click instead of unselecting immediately,
  // since that history stops being offered for new beneficiaries/
  // distributions the moment this cause is off, and any allocated amount
  // is freed back into the unallocated pool (see toggle() below; the
  // history itself is never lost, just no longer an option going
  // forward).
  const [confirmUnselect, setConfirmUnselect] = useState<{ category: CauseCategory; cause: WaqfCause } | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`),
      apiFetchJson<CauseCategory[]>("/cause-categories"),
      apiFetchJson<CauseAllocationSummary>(`/waqf-causes/allocation-summary?waqfId=${waqfId}`),
    ])
      .then(([causesData, categoriesData, summaryData]) => {
        setCauses(causesData);
        setCategories(categoriesData);
        setSummary(summaryData);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  const pool = Number(amountRaised);
  const catalogCauses = (causes ?? []).filter((c) => c.causeCategoryId);
  const totalAllocated = catalogCauses.reduce((sum, c) => sum + Number(c.allocatedAmount ?? 0), 0);
  // The server's figure (it also keeps back what removed causes already
  // gave out); worked out here only until it has loaded.
  const availableToAllocate = summary ? Number(summary.available) : pool - totalAllocated;
  const heldByRemovedCauses = Number(summary?.heldByRemovedCauses ?? 0);
  const committedOf = (cause: WaqfCause) => Number(cause.committedAmount ?? 0);

  async function allocate(cause: WaqfCause, amount: string, reason?: string) {
    setActionError(null);
    try {
      await apiFetchJson(`/waqf-causes/${cause.id}/allocate`, {
        method: "POST",
        body: JSON.stringify({ amount, ...(reason && { reason }) }),
      });
      setPanel(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function move(from: WaqfCause, input: { toCauseId: string; amount: string; reason: string }) {
    setActionError(null);
    try {
      await apiFetchJson(`/waqf-causes/${from.id}/move`, { method: "POST", body: JSON.stringify(input) });
      setPanel(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function toggle(category: CauseCategory) {
    const selected = causes?.find((c) => c.causeCategoryId === category.id);
    if (selected) {
      // 2026-09-29 codebase walkthrough finding, two gaps closed here:
      // (1) unselecting a cause with money already allocated to it
      // silently frees that amount back into the unallocated pool — the
      // ceiling check (WaqfCausesService.allocate) only ever sums
      // *active* causes, so a hidden cause's old allocatedAmount simply
      // stops counting, with no warning that this is what "removing"
      // it actually does. (2) a pending beneficiary nomination on this
      // cause was never covered by the warning at all, since it isn't a
      // real Beneficiary row yet.
      const hasBeneficiaries = (selected._count?.beneficiaries ?? 0) > 0;
      const hasDistributions = (selected._count?.distributions ?? 0) > 0;
      const hasPendingNomination = (selected._count?.pendingNominations ?? 0) > 0;
      const hasAllocation = Number(selected.allocatedAmount ?? 0) > 0;
      const needsConfirm = hasBeneficiaries || hasDistributions || hasPendingNomination || hasAllocation;
      if (needsConfirm && confirmUnselect?.cause.id !== selected.id) {
        setConfirmUnselect({ category, cause: selected });
        setUnselectReason("");
        return;
      }
    }
    const reason = unselectReason.trim();
    setConfirmUnselect(null);
    setActionError(null);
    setPendingCategoryId(category.id);
    try {
      if (selected) {
        await apiFetchJson(`/waqf-causes/${selected.id}/unselect`, {
          method: "POST",
          body: JSON.stringify(reason ? { reason } : {}),
        });
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
    <div className="mt-8 border-t border-slate-100 pt-7">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[15px] font-semibold text-slate-900">Causes</p>
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
            {confirmUnselect.cause._count?.pendingNominations ? (
              <>
                {confirmUnselect.cause._count.pendingNominations} beneficiary nomination
                {confirmUnselect.cause._count.pendingNominations === 1 ? " is" : "s are"} still waiting on Birr's
                review for this cause.{" "}
              </>
            ) : null}
            That history is kept and stays visible to Birr — nothing is deleted. But once removed, this cause won't
            be offered for any new beneficiaries or distributions on this fund until you select it again.
          </p>
          {Number(confirmUnselect.cause.allocatedAmount ?? 0) > 0 ? (
            <>
              <p className="mt-2">
                {committedOf(confirmUnselect.cause) > 0 ? (
                  <>
                    Of the {corpusCurrency} {formatAmount(confirmUnselect.cause.allocatedAmount ?? "0")} allocated to this cause,{" "}
                    {corpusCurrency} {formatAmount(committedOf(confirmUnselect.cause))} has already been committed to its beneficiaries and stays
                    counted. The other {corpusCurrency}{" "}
                    {formatAmount(Number(confirmUnselect.cause.allocatedAmount ?? 0) - committedOf(confirmUnselect.cause))} goes back to this
                    fund&apos;s unallocated pool.
                  </>
                ) : (
                  <>
                    The {corpusCurrency} {formatAmount(confirmUnselect.cause.allocatedAmount ?? "0")} currently allocated to this cause will be
                    freed back into this fund&apos;s unallocated pool, available to allocate to another cause.
                  </>
                )}
              </p>
              <label htmlFor="unselect-reason" className="mb-1 mt-3 block text-sm font-medium text-slate-800">
                Why are you removing it?
              </label>
              <textarea
                id="unselect-reason"
                rows={2}
                maxLength={500}
                value={unselectReason}
                onChange={(e) => setUnselectReason(e.target.value)}
                className={textareaClass}
              />
              <p className="mt-1 text-xs text-slate-600">Kept in this fund&apos;s records, and shared with your Birr Mutawalli Officer.</p>
            </>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="danger"
              className="px-3 py-1.5 text-xs"
              disabled={Number(confirmUnselect.cause.allocatedAmount ?? 0) > 0 && unselectReason.trim().length < REASON_MIN}
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
          <p className="mb-1 text-[15px] font-semibold text-slate-900">Allocation</p>
          <p className="mb-4 text-sm text-slate-500">
            {waqfType === "investment"
              ? // Update, 2026-09-14 — for Investment funds, corpus allocation is
                // a preservation record, not a spending ceiling: only staff-set
                // investment proceeds (shown further down, once recorded) ever
                // reach a cause's beneficiaries. Corpus itself stays invested.
                "How much of this fund's raised corpus you're earmarking to each cause, as a target — the corpus itself stays invested; investment proceeds are what actually reaches each cause's beneficiaries."
              : "How much of this fund's raised funds goes to each cause — and from there, to that cause's beneficiaries."}
          </p>

          {pool === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-sm text-slate-500">Nothing raised yet — nothing to allocate until this fund receives a contribution.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                {corpusCurrency} {formatAmount(availableToAllocate)} of {corpusCurrency} {formatAmount(pool)}{" "}
                unallocated.
                {heldByRemovedCauses > 0 && (
                  <span className="block text-xs text-slate-500">
                    {corpusCurrency} {formatAmount(heldByRemovedCauses)} stays counted for causes you&apos;ve removed: it was already committed
                    to their beneficiaries.
                  </span>
                )}
              </p>
              <div className="space-y-2">
                {catalogCauses.map((cause) => {
                  const allocated = Number(cause.allocatedAmount ?? 0);
                  const committed = committedOf(cause);
                  const movable = allocated - committed;
                  const others = catalogCauses.filter((c) => c.id !== cause.id);
                  const open = panel?.causeId === cause.id ? panel.mode : null;
                  return (
                    <div key={cause.id} className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{cause.name}</p>
                          <p className="text-sm text-slate-500">
                            {cause.allocatedAmount !== null
                              ? `${corpusCurrency} ${formatAmount(cause.allocatedAmount)} allocated`
                              : "Not allocated yet"}
                          </p>
                          {committed > 0 && (
                            <p className="text-xs text-slate-500">
                              {corpusCurrency} {formatAmount(committed)} already committed to its beneficiaries
                            </p>
                          )}
                          {/* Birr-staff-authored, read-only here — see
                              WaqfCause.projectPlan's own schema comment. */}
                          {cause.projectPlan && <p className="mt-1 text-xs text-slate-500">{cause.projectPlan}</p>}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {movable > 0 && others.length > 0 && open !== "allocate" && (
                            <Button
                              type="button"
                              variant="secondary"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => setPanel(open === "move" ? null : { causeId: cause.id, mode: "move" })}
                            >
                              {open === "move" ? "Cancel" : "Move"}
                            </Button>
                          )}
                          {open !== "move" && (
                            <Button
                              type="button"
                              variant="secondary"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => setPanel(open === "allocate" ? null : { causeId: cause.id, mode: "allocate" })}
                            >
                              {open === "allocate" ? "Cancel" : allocated > 0 ? "Change" : "Allocate"}
                            </Button>
                          )}
                        </div>
                      </div>
                      {open === "allocate" && (
                        <AllocateForm
                          cause={cause}
                          maxAvailable={availableToAllocate + Math.max(allocated, committed)}
                          floor={committed}
                          unallocated={availableToAllocate}
                          currency={corpusCurrency}
                          onSubmit={(amount, reason) => allocate(cause, amount, reason)}
                          onCancel={() => setPanel(null)}
                        />
                      )}
                      {open === "move" && (
                        <MoveForm
                          from={cause}
                          others={others}
                          movable={movable}
                          committed={committed}
                          currency={corpusCurrency}
                          onSubmit={(input) => move(cause, input)}
                          onCancel={() => setPanel(null)}
                        />
                      )}
                    </div>
                  );
                })}
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
                {cause.projectPlan && <span className="mt-1 block text-xs text-slate-500">{cause.projectPlan}</span>}
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
          <Input check="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
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
 * One cause's allocation. A first allocation saves straight away; changing
 * one that's already set goes through a review first (2026-11-16): what it
 * is now and will be, the floor it can't go below (what's already
 * committed to the cause, on Asset and Project funds), and what that
 * leaves unallocated, plus a reason whenever it's lowered. `maxAvailable`
 * already folds this cause's own allocation back in, so raising and
 * lowering both work against the same ceiling.
 */
function AllocateForm({
  cause,
  maxAvailable,
  floor,
  unallocated,
  currency,
  onSubmit,
  onCancel,
}: {
  cause: WaqfCause;
  maxAvailable: number;
  floor: number;
  unallocated: number;
  currency: string | null;
  onSubmit: (amount: string, reason?: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const current = Number(cause.allocatedAmount ?? 0);
  const isFirst = current === 0;
  const [amount, setAmount] = useState(cause.allocatedAmount ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsed = Number(amount);
  const entered = amount.trim().length > 0 && Number.isFinite(parsed);
  const belowFloor = entered && parsed < floor;
  const aboveMax = entered && parsed > maxAvailable;
  const isValid = entered && parsed >= 0 && !belowFloor && !aboveMax && (isFirst || parsed !== current);
  const lowering = !isFirst && parsed < current;
  const money = (n: number) => `${currency ?? ""} ${formatAmount(n)}`.trim();

  async function save() {
    setSubmitting(true);
    await onSubmit(amount, lowering ? reason.trim() : undefined);
    setSubmitting(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    if (isFirst) void save();
    else setReviewing(true);
  }

  if (reviewing) {
    const difference = parsed - current;
    return (
      <div className="mt-3 space-y-3 border-t border-slate-100 pt-3" role="region" aria-label="Review the change">
        <p className="text-sm font-medium text-slate-900">Review the change</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Now</dt>
          <dd className="tabular-nums text-slate-900">{money(current)}</dd>
          <dt className="text-slate-500">New</dt>
          <dd className="tabular-nums text-slate-900">
            {money(parsed)}{" "}
            <span className={difference < 0 ? "text-amber-700" : "text-primary-700"}>
              ({difference < 0 ? "−" : "+"}
              {money(Math.abs(difference))})
            </span>
          </dd>
          <dt className="text-slate-500">Unallocated</dt>
          <dd className="tabular-nums text-slate-900">
            {money(unallocated)} → {money(unallocated - difference)}
          </dd>
          {floor > 0 && (
            <>
              <dt className="text-slate-500">Committed</dt>
              <dd className="text-slate-900">
                {money(floor)} already committed to its beneficiaries, so it can&apos;t go below that.
              </dd>
            </>
          )}
        </dl>
        {lowering && (
          <div>
            <label htmlFor={`reason-${cause.id}`} className="mb-1 block text-sm font-medium text-slate-700">
              Why are you lowering it?
            </label>
            <textarea
              id={`reason-${cause.id}`}
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={textareaClass}
            />
            <p className="mt-1 text-xs text-slate-500">Kept in this fund&apos;s records, and shared with your Birr Mutawalli Officer.</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            disabled={submitting || (lowering && reason.trim().length < REASON_MIN)}
            onClick={() => void save()}
          >
            {submitting ? "Saving…" : "Confirm change"}
          </Button>
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setReviewing(false)}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
      <div className="w-44 space-y-1.5">
        <label htmlFor={`amount-${cause.id}`} className="text-sm font-medium text-slate-700">
          Amount ({currency})
        </label>
        <Input
          id={`amount-${cause.id}`}
          type="number"
          min={floor}
          max={maxAvailable}
          step="0.01"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {belowFloor && <p className="text-xs text-red-600">Can&apos;t go below {money(floor)}, already committed.</p>}
        {aboveMax && <p className="text-xs text-red-600">Up to {money(maxAvailable)} available.</p>}
      </div>
      <Button type="submit" disabled={!isValid || submitting} className="px-3 py-1.5 text-xs">
        {isFirst ? (submitting ? "Saving…" : "Save") : "Review"}
      </Button>
      <Button type="button" variant="secondary" onClick={onCancel} className="px-3 py-1.5 text-xs">
        Cancel
      </Button>
    </form>
  );
}

/**
 * Moves part of this cause's allocation to another cause of the same
 * fund in one step (2026-11-16), so the fund's total allocation stays
 * the same. Only what isn't already committed can move. Reviewed, with a
 * reason, before it's sent.
 */
function MoveForm({
  from,
  others,
  movable,
  committed,
  currency,
  onSubmit,
  onCancel,
}: {
  from: WaqfCause;
  others: WaqfCause[];
  movable: number;
  committed: number;
  currency: string | null;
  onSubmit: (input: { toCauseId: string; amount: string; reason: string }) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [toCauseId, setToCauseId] = useState(others[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsed = Number(amount);
  const isValid = Boolean(toCauseId) && amount.trim().length > 0 && Number.isFinite(parsed) && parsed > 0 && parsed <= movable;
  const to = others.find((c) => c.id === toCauseId);
  const fromNow = Number(from.allocatedAmount ?? 0);
  const toNow = Number(to?.allocatedAmount ?? 0);
  const money = (n: number) => `${currency ?? ""} ${formatAmount(n)}`.trim();

  async function confirm() {
    setSubmitting(true);
    await onSubmit({ toCauseId, amount, reason: reason.trim() });
    setSubmitting(false);
  }

  if (reviewing && to) {
    return (
      <div className="mt-3 space-y-3 border-t border-slate-100 pt-3" role="region" aria-label="Review the move">
        <p className="text-sm font-medium text-slate-900">
          Move {money(parsed)} from {from.name} to {to.name}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">{from.name}</dt>
          <dd className="tabular-nums text-slate-900">
            {money(fromNow)} → {money(fromNow - parsed)}
          </dd>
          <dt className="text-slate-500">{to.name}</dt>
          <dd className="tabular-nums text-slate-900">
            {money(toNow)} → {money(toNow + parsed)}
          </dd>
          <dt className="text-slate-500">Unallocated</dt>
          <dd className="text-slate-900">Unchanged</dd>
        </dl>
        <div>
          <label htmlFor={`move-reason-${from.id}`} className="mb-1 block text-sm font-medium text-slate-700">
            Why are you moving it?
          </label>
          <textarea
            id={`move-reason-${from.id}`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={textareaClass}
          />
          <p className="mt-1 text-xs text-slate-500">Kept in this fund&apos;s records, and shared with your Birr Mutawalli Officer.</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            disabled={submitting || reason.trim().length < REASON_MIN}
            onClick={() => void confirm()}
          >
            {submitting ? "Moving…" : "Confirm move"}
          </Button>
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setReviewing(false)}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isValid) setReviewing(true);
      }}
      className="mt-3 space-y-3 border-t border-slate-100 pt-3"
    >
      <p className="text-xs text-slate-500">
        {money(movable)} can move from {from.name}
        {committed > 0 ? ` (${money(committed)} is already committed to its beneficiaries and stays).` : "."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label htmlFor={`move-to-${from.id}`} className="text-sm font-medium text-slate-700">
            Move to
          </label>
          <Select id={`move-to-${from.id}`} className="w-full" value={toCauseId} onChange={(e) => setToCauseId(e.target.value)}>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44 space-y-1.5">
          <label htmlFor={`move-amount-${from.id}`} className="text-sm font-medium text-slate-700">
            Amount ({currency})
          </label>
          <Input
            id={`move-amount-${from.id}`}
            type="number"
            min="0"
            max={movable}
            step="0.01"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <button type="button" className="pb-2.5 text-xs font-medium text-primary-700 hover:text-primary-900" onClick={() => setAmount(String(movable))}>
          Move all {money(movable)}
        </button>
      </div>
      {amount.trim().length > 0 && parsed > movable && <p className="text-xs text-red-600">Up to {money(movable)} can move.</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!isValid} className="px-3 py-1.5 text-xs">
          Review
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="px-3 py-1.5 text-xs">
          Cancel
        </Button>
      </div>
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
    <div className="grid gap-2 sm:grid-cols-2">
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
    <div className="sm:col-span-2">
      <p className="flex items-center gap-1.5 px-1 py-1 text-sm font-medium text-slate-700">
        {node.category.icon && <span>{node.category.icon}</span>}
        {node.category.name}
      </p>
      <div className="ml-4 grid gap-2 border-l border-slate-200 pl-3 sm:grid-cols-2">
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
      className={`flex h-full cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors ${
        isSelected ? "border-primary-300 bg-primary-50 ring-1 ring-inset ring-primary-200" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
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
        {category.description && <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{category.description}</span>}
      </span>
    </label>
  );
}
