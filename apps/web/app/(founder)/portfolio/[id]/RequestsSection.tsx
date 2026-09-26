"use client";

// The Founder Portal's "request" half of "view, request" (CLAUDE.md's
// Tech principles) — until this section, a Founder asking for a
// distribution approval, an investment change, a beneficiary-criteria
// change, or an asset disposal had no structured way to do it: free
// text in Messages, with no type, no status, nothing triage-able as a
// queue. Submitting one here never touches governed_actions (see
// FounderRequest's own schema comment) — staff review it and, if they
// agree, create the real governed_action themselves through the normal
// Ops flow. No beneficiaryId anywhere in the form below — a Founder
// never sees individual Beneficiary rows (see BeneficiariesSection's
// own comment); requests about a beneficiary are named by Cause plus a
// free-text description instead.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import type { Asset, FounderRequest, FounderRequestType, WaqfCause } from "../../../../lib/types";
import { Alert, Badge, Button, Input, Skeleton } from "@birr/ui";

const REQUEST_TYPE_LABEL: Record<FounderRequestType, string> = {
  distribution_approval: "Distribution approval",
  investment_change: "Investment change",
  beneficiary_criteria_change: "Beneficiary criteria change",
  asset_disposal: "Asset disposal",
  other: "Something else",
};

const STATUS_TONE: Record<FounderRequest["status"], "info" | "warning" | "success" | "danger"> = {
  pending: "info",
  in_review: "warning",
  actioned: "success",
  declined: "danger",
};

const STATUS_LABEL: Record<FounderRequest["status"], string> = {
  pending: "Pending",
  in_review: "In review",
  actioned: "Actioned",
  declined: "Declined",
};

export function RequestsSection({
  waqfId,
  waqfType,
  currency,
}: {
  waqfId: string;
  waqfType: "investment" | "asset" | "project";
  currency: string | null;
}) {
  const [requests, setRequests] = useState<FounderRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<FounderRequest[]>(`/founder-requests?waqfId=${waqfId}`)
      .then(setRequests)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Requests</p>
          <p className="text-sm text-slate-500">
            Ask Birr's staff for a distribution, an investment change, or another decision on this fund.
          </p>
        </div>
        {!showForm && (
          <Button variant="secondary" className="shrink-0" onClick={() => setShowForm(true)}>
            New request
          </Button>
        )}
      </div>

      {showForm && (
        <RequestFormPanel
          waqfId={waqfId}
          waqfType={waqfType}
          currency={currency}
          onSubmitted={() => {
            setShowForm(false);
            load();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load requests" className="mt-4">
          {error}
        </Alert>
      )}

      {!error && requests === null && (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!error && requests !== null && requests.length === 0 && !showForm && (
        <p className="mt-3 text-sm text-slate-500">No requests submitted yet.</p>
      )}

      {!error && requests !== null && requests.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {requests.map((r) => (
            <div key={r.id} className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="font-medium text-slate-900">{REQUEST_TYPE_LABEL[r.type]}</span>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(r.createdAt)}</span>
                </div>
              </div>
              {r.note && <p className="mt-1 text-sm text-slate-600">{r.note}</p>}
              {r.reviewNote && (
                <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
                  Birr staff{r.reviewedByStaff ? ` (${r.reviewedByStaff.user.fullName})` : ""}: {r.reviewNote}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestFormPanel({
  waqfId,
  waqfType,
  currency,
  onSubmitted,
  onCancel,
}: {
  waqfId: string;
  waqfType: "investment" | "asset" | "project";
  currency: string | null;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<FounderRequestType>("distribution_approval");
  const [causeId, setCauseId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [instrumentType, setInstrumentType] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [causes, setCauses] = useState<WaqfCause[] | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`).then(setCauses).catch(() => setCauses([]));
    apiFetchJson<Asset[]>(`/assets?waqfId=${waqfId}`).then(setAssets).catch(() => setAssets([]));
  }, [waqfId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let details: Record<string, unknown>;
    if (type === "distribution_approval") {
      if (!causeId || !amount.trim() || !description.trim()) {
        setError("Cause, amount, and description are all required.");
        return;
      }
      details = { causeId, amount: amount.trim(), description: description.trim() };
    } else if (type === "investment_change") {
      if (!instrumentType.trim() || !amount.trim() || !description.trim()) {
        setError("Instrument, proposed allocation, and description are all required.");
        return;
      }
      details = { instrumentType: instrumentType.trim(), proposedAllocation: amount.trim(), description: description.trim() };
    } else if (type === "beneficiary_criteria_change") {
      if (!causeId || !description.trim()) {
        setError("Cause and description are both required.");
        return;
      }
      details = { causeId, description: description.trim() };
    } else if (type === "asset_disposal") {
      if (!assetId || !reason.trim()) {
        setError("Asset and reason are both required.");
        return;
      }
      details = { assetId, reason: reason.trim() };
    } else {
      if (!description.trim()) {
        setError("Please describe what you're asking for.");
        return;
      }
      details = { description: description.trim() };
    }

    setSubmitting(true);
    try {
      await apiFetchJson("/founder-requests", {
        method: "POST",
        body: JSON.stringify({ waqfId, type, details, note: note.trim() || undefined }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const availableTypes: FounderRequestType[] =
    waqfType === "investment"
      ? ["distribution_approval", "investment_change", "beneficiary_criteria_change", "other"]
      : ["distribution_approval", "beneficiary_criteria_change", "asset_disposal", "other"];

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't submit request">
          {error}
        </Alert>
      )}

      <div className="space-y-1.5">
        <label htmlFor="founder-request-type" className="text-sm font-medium text-slate-700">
          What's this about?
        </label>
        <select
          id="founder-request-type"
          value={type}
          onChange={(e) => setType(e.target.value as FounderRequestType)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {REQUEST_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {(type === "distribution_approval" || type === "beneficiary_criteria_change") && (
        <div className="space-y-1.5">
          <label htmlFor="founder-request-cause" className="text-sm font-medium text-slate-700">
            Cause
          </label>
          <select
            id="founder-request-cause"
            value={causeId}
            onChange={(e) => setCauseId(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Select a cause…</option>
            {(causes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "distribution_approval" && (
        <div className="space-y-1.5">
          <label htmlFor="founder-request-amount" className="text-sm font-medium text-slate-700">
            Amount{currency ? ` (${currency})` : ""}
          </label>
          <Input id="founder-request-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}

      {type === "investment_change" && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="founder-request-instrument" className="text-sm font-medium text-slate-700">
              Instrument
            </label>
            <Input id="founder-request-instrument" value={instrumentType} onChange={(e) => setInstrumentType(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="founder-request-proposed-allocation" className="text-sm font-medium text-slate-700">
              Proposed allocation{currency ? ` (${currency})` : ""}
            </label>
            <Input
              id="founder-request-proposed-allocation"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </>
      )}

      {type === "asset_disposal" && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="founder-request-asset" className="text-sm font-medium text-slate-700">
              Asset
            </label>
            <select
              id="founder-request-asset"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select an asset…</option>
              {(assets ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="founder-request-reason" className="text-sm font-medium text-slate-700">
              Reason
            </label>
            <Input id="founder-request-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
        </>
      )}

      {type !== "asset_disposal" && (
        <div className="space-y-1.5">
          <label htmlFor="founder-request-description" className="text-sm font-medium text-slate-700">
            Description
          </label>
          <Input id="founder-request-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="founder-request-note" className="text-sm font-medium text-slate-700">
          Anything else? (optional)
        </label>
        <Input id="founder-request-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit request"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
