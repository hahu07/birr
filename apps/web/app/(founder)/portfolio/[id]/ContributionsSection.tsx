"use client";

// Founder-facing funding progress + contribution history, plus the
// entry point to add more later (top-up) — same fetch/table shape as
// the sibling *Section.tsx components on this page (see AssetsSection).
// No progress bar/section at all when the waqf predates this feature
// (corpusAmount is null — no backfill was attempted, see the schema's
// own comment) since there's no target to measure against.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import type { Contribution, Waqf } from "../../../../lib/types";
import {
  Alert,
  Badge,
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const STATUS_TONE: Record<Contribution["status"], "success" | "warning" | "danger"> = {
  pending: "warning",
  confirmed: "success",
  failed: "danger",
};

export function ContributionsSection({ waqf, onCorpusIncreased }: { waqf: Waqf; onCorpusIncreased: () => void }) {
  const [contributions, setContributions] = useState<Contribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showIncreaseTarget, setShowIncreaseTarget] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Contribution[]>(`/contributions?waqfId=${waqf.id}`)
      .then((data) => {
        if (!cancelled) setContributions(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqf.id]);

  const raised = Number(waqf.amountRaised ?? "0");
  const target = waqf.corpusAmount ? Number(waqf.corpusAmount) : null;
  const percent = target ? Math.min(100, (raised / target) * 100) : null;

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Funding</p>
          <p className="text-sm text-slate-500">
            {target
              ? `${humanize(waqf.fundingPlan)} — ${waqf.corpusCurrency} ${raised.toLocaleString()} of ${
                  waqf.corpusCurrency
                } ${target.toLocaleString()} raised${raised >= target ? " (fully funded)" : ""}`
              : "How this fund has been dedicated so far."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {target !== null && (
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => setShowIncreaseTarget((v) => !v)}
            >
              {showIncreaseTarget ? "Cancel" : "Increase target"}
            </Button>
          )}
          <Link href={`/portfolio/${waqf.id}/top-up`}>
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs">
              Top up
            </Button>
          </Link>
        </div>
      </div>

      {showIncreaseTarget && target !== null && (
        <IncreaseTargetForm
          waqfId={waqf.id}
          currentAmount={target}
          currency={waqf.corpusCurrency ?? ""}
          onDone={() => {
            setShowIncreaseTarget(false);
            onCorpusIncreased();
          }}
          onCancel={() => setShowIncreaseTarget(false)}
        />
      )}

      {percent !== null && (
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-primary-600" style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load contributions">
          {error}
        </Alert>
      )}

      {!error && contributions === null && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {!error && contributions !== null && contributions.length === 0 && (
        <p className="text-sm text-slate-500">No contributions yet.</p>
      )}

      {!error && contributions !== null && contributions.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Method</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Date</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {contributions.map((contribution) => (
              <TableRow key={contribution.id}>
                <TableCell className="font-medium text-slate-900">
                  {contribution.currency} {formatAmount(contribution.amount)}
                </TableCell>
                <TableCell className="text-slate-500">{humanize(contribution.provider)}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[contribution.status]}>{humanize(contribution.status)}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-500">
                  {formatDate(contribution.confirmedAt ?? contribution.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * A deliberately separate action from paying a contribution (Top up) —
 * this raises the declared target itself, not what's been paid toward
 * it. The input is how much to add, not the new total — any positive
 * amount is valid here (unlike a "new total" field, which would have to
 * exceed the current target to mean anything, and reads oddly for a
 * small top-up-sized increase). The resulting total is computed here and
 * sent to the backend, which still independently enforces that it comes
 * out strictly above the current target.
 */
function IncreaseTargetForm({
  waqfId,
  currentAmount,
  currency,
  onDone,
  onCancel,
}: {
  waqfId: string;
  currentAmount: number;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [addAmount, setAddAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(addAmount);
  const isValid = addAmount.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
  const newTotal = isValid ? currentAmount + parsed : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || newTotal === null) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/waqfs/${waqfId}/increase-corpus-target`, {
        method: "POST",
        body: JSON.stringify({ corpusAmount: String(newTotal) }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't increase the corpus target">
          {error}
        </Alert>
      )}
      <p className="text-sm text-slate-600">
        Add to this fund's total endowment target — currently {currency} {currentAmount.toLocaleString()}. This only
        changes what you're pledging toward — it isn't a payment; use "Top up" for that.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label htmlFor="addCorpusAmount" className="text-sm font-medium text-slate-700">
            Amount to add ({currency})
          </label>
          <Input
            id="addCorpusAmount"
            type="number"
            min="0.01"
            step="0.01"
            required
            autoFocus
            value={addAmount}
            onChange={(e) => setAddAmount(e.target.value)}
          />
          {addAmount.trim().length > 0 && !isValid && (
            <p className="text-xs text-red-600">Enter an amount greater than zero.</p>
          )}
          {newTotal !== null && (
            <p className="text-xs text-slate-500">
              New target: {currency} {newTotal.toLocaleString()}
            </p>
          )}
        </div>
        <Button type="submit" disabled={!isValid || submitting}>
          {submitting ? "Saving…" : "Save new target"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
