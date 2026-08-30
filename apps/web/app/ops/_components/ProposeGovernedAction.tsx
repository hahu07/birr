"use client";

// Bare-click propose control for a governed_actions permission that
// needs no extra input from staff (asset.dispose, distribution.approve,
// beneficiary.status_change) — POSTs to the fully generic
// /governed-actions route and shows "Pending approval" instead of an
// immediate result, since this is a maker-checker action: the real
// effect only happens once a different, eligible staff member decides
// it on the Approval Queue (/ops/governed-actions), which renders any
// payload generically and needed zero changes to pick this up.
//
// Governed actions whose payload needs a value from staff (investment
// .change's newAllocatedAmount, beneficiary.criteria_update's
// newCriteria) don't use this — they're small bespoke inline components
// in their own section files instead, matching this codebase's existing
// per-file inline-edit convention (e.g. CausesSection.tsx's
// ProceedsAllocationCell) rather than forcing a second, more complex
// shared abstraction for two different field shapes.
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Button } from "@birr/ui";

export function ProposeGovernedActionButton({
  permissionKey,
  payload,
  label,
  onProposed,
}: {
  permissionKey: string;
  payload: Record<string, unknown>;
  label: string;
  onProposed: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [proposed, setProposed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey, payload }),
      });
      setProposed(true);
      onProposed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (proposed) {
    return <span className="text-xs text-slate-400">Pending approval</span>;
  }

  return (
    <div>
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={submitting} onClick={propose}>
        {submitting ? "Proposing…" : label}
      </Button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
