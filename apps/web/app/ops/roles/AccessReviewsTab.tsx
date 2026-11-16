"use client";

// The periodic access review (owner's decision, 2026-11-16): every 90
// days a Board member confirms each role's permissions are still right,
// or notes what needs changing. A review changes nothing by itself; a
// needed change is staged on "By role" and sent for approval.
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import type { AccessReviewOutcome, AccessReviewsStatus, Role, RolesOverview } from "../../../lib/ops-types";
import { permissionLabel } from "../../../lib/permission-labels";
import { Alert, Badge, Button, Card, EmptyState } from "@birr/ui";

const textareaClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export function AccessReviewsTab({
  overview,
  status,
  canReview,
  onCompleted,
}: {
  overview: RolesOverview;
  status: AccessReviewsStatus;
  canReview: boolean;
  onCompleted: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const due = !status.nextDueAt || new Date(status.nextDueAt) <= new Date();

  return (
    <div className="space-y-8">
      <Card tone={due ? "accent" : "neutral"} className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {status.lastCompletedAt ? `Last reviewed ${formatDate(status.lastCompletedAt)} by ${status.reviews[0]?.reviewedBy ?? "—"}` : "No access review recorded yet"}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            {due
              ? `A review is due now. Every ${status.intervalDays} days a Board member confirms each role's permissions are still right.`
              : `Next due ${formatDate(status.nextDueAt!)}. Every ${status.intervalDays} days a Board member confirms each role's permissions are still right.`}
          </p>
        </div>
        {canReview && !reviewing && <Button onClick={() => setReviewing(true)}>Start review</Button>}
      </Card>

      {reviewing && (
        <ReviewForm
          overview={overview}
          onCancel={() => setReviewing(false)}
          onDone={() => {
            setReviewing(false);
            onCompleted();
          }}
        />
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Past reviews</h2>
        {status.reviews.length === 0 ? (
          <EmptyState title="No reviews yet" description="Completed access reviews are kept here, with each role's outcome and the permissions at that moment." />
        ) : (
          <div className="space-y-3">
            {status.reviews.map((r) => (
              <PastReview key={r.id} review={r} overview={overview} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PastReview({ review, overview }: { review: AccessReviewsStatus["reviews"][number]; overview: RolesOverview }) {
  const [open, setOpen] = useState(false);
  const needs = review.outcomes.filter((o) => o.outcome === "changes_needed");
  const roleName = (key: string) => overview.roles.find((r) => r.key === key)?.name ?? key;
  return (
    <Card>
      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">{formatDate(review.completedAt)}</span> · by {review.reviewedBy}
        </span>
        <span className="flex items-center gap-2">
          {needs.length > 0 ? <Badge tone="warning">{needs.length} needed changes</Badge> : <Badge tone="success">All confirmed</Badge>}
          <span className="text-xs font-medium text-primary-700">{open ? "Hide" : "Details"}</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
          {review.notes && <p className="text-slate-700">{review.notes}</p>}
          <ul className="space-y-1">
            {review.outcomes.map((o) => (
              <li key={o.roleKey} className="text-slate-700">
                <span className="font-medium text-slate-900">{roleName(o.roleKey)}</span>: {o.outcome === "confirmed" ? "confirmed" : "needs changes"}
                {o.note && <span className="text-slate-600"> — {o.note}</span>}
              </li>
            ))}
          </ul>
          <p className="font-mono text-xs text-slate-400" title="SHA-256 of every grant at the time of the review">
            Snapshot {review.snapshotHash.slice(0, 16)}…
          </p>
        </div>
      )}
    </Card>
  );
}

type Draft = Record<string, { outcome: AccessReviewOutcome["outcome"] | null; note: string }>;

function ReviewForm({ overview, onCancel, onDone }: { overview: RolesOverview; onCancel: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(overview.roles.map((r) => [r.key, { outcome: null, note: "" }])));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decided = overview.roles.filter((r) => draft[r.key].outcome).length;
  const missingNote = overview.roles.some((r) => draft[r.key].outcome === "changes_needed" && draft[r.key].note.trim().length < 5);
  const ready = decided === overview.roles.length && !missingNote && !submitting;

  async function complete() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetchJson("/roles/access-reviews", {
        method: "POST",
        body: JSON.stringify({
          outcomes: overview.roles.map((r) => ({ roleKey: r.key, outcome: draft[r.key].outcome, note: draft[r.key].note.trim() || null })),
          notes: notes.trim() || undefined,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Access review</h2>
        <p className="mt-0.5 text-sm text-slate-600">
          For each role, check its permissions and people, then confirm them or note what needs changing. Changes themselves are proposed on
          &quot;By role&quot;. The permissions as they stand now are saved with your review.
        </p>
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete the review">
          {error}
        </Alert>
      )}
      <ol className="space-y-3">
        {overview.roles.map((role) => (
          <RoleReviewItem
            key={role.key}
            role={role}
            people={overview.holders[role.key]?.length ?? 0}
            value={draft[role.key]}
            onChange={(next) => setDraft((prev) => ({ ...prev, [role.key]: next }))}
          />
        ))}
      </ol>
      <div>
        <label htmlFor="review-notes" className="mb-1.5 block text-sm font-medium text-slate-700">
          Notes for the record (optional)
        </label>
        <textarea id="review-notes" rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClass} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-slate-500">
          {decided} of {overview.roles.length} roles reviewed
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void complete()} disabled={!ready}>
            {submitting ? "Saving…" : "Complete review"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RoleReviewItem({
  role,
  people,
  value,
  onChange,
}: {
  role: Role;
  people: number;
  value: Draft[string];
  onChange: (next: Draft[string]) => void;
}) {
  const [showGrants, setShowGrants] = useState(false);
  const granted = role.rolePermissions.filter((rp) => rp.canMaker || rp.canChecker);
  const approvals = granted.filter((rp) => rp.permission.requiresMakerChecker).length;
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{role.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {people} {people === 1 ? "person" : "people"} · {approvals} approval {approvals === 1 ? "action" : "actions"} · {granted.length - approvals} access{" "}
            {granted.length - approvals === 1 ? "permission" : "permissions"} ·{" "}
            <button type="button" className="font-medium text-primary-700" onClick={() => setShowGrants((v) => !v)}>
              {showGrants ? "Hide" : "Show"} permissions
            </button>
          </p>
        </div>
        <div role="radiogroup" aria-label={`${role.name} outcome`} className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {(["confirmed", "changes_needed"] as const).map((outcome) => (
            <button
              key={outcome}
              type="button"
              role="radio"
              aria-checked={value.outcome === outcome}
              onClick={() => onChange({ ...value, outcome })}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${value.outcome === outcome ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              {outcome === "confirmed" ? "Confirmed" : "Needs change"}
            </button>
          ))}
        </div>
      </div>
      {showGrants && (
        <ul className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          {granted.map((rp) => (
            <li key={rp.permission.key}>
              {permissionLabel(rp.permission)}
              {rp.permission.requiresMakerChecker && <span className="text-slate-400"> ({rp.canMaker ? "proposes" : "approves"})</span>}
            </li>
          ))}
        </ul>
      )}
      {value.outcome === "changes_needed" && (
        <div className="mt-3">
          <label htmlFor={`note-${role.key}`} className="mb-1 block text-xs font-medium text-slate-700">
            What needs changing?
          </label>
          <textarea id={`note-${role.key}`} rows={2} maxLength={1000} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} className={textareaClass} />
        </div>
      )}
    </li>
  );
}
