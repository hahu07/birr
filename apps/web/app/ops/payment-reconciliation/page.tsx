"use client";

// Daily Paystack reconciliation (2026-11-15): each Lagos day, Paystack's
// records of money in, money out and Vault refunds are compared with
// Birr's. Mismatches are listed here for Compliance; nothing is corrected
// automatically. Viewing: payments.reconciliation_view. Asking Paystack
// again and resolving: payments.reconciliation_resolve. Running a day:
// payments.reconciliation_run.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney, humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import { Alert, Badge, Button, EmptyState, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";

interface Counts {
  in?: { paystack: number; birr: number };
  out?: { paystack: number; birr: number };
  refunds?: { paystack: number; birr: number };
  mismatches?: number;
  newIssues?: number;
}

interface Run {
  id: string;
  day: string;
  status: "running" | "clean" | "issues" | "failed";
  error: string | null;
  trigger: string;
  counts: Counts | null;
  startedAt: string;
  finishedAt: string | null;
  startedBy: { fullName: string } | null;
}

interface Issue {
  id: string;
  direction: "in" | "out" | "refund";
  kind: string;
  providerReference: string;
  product: string | null;
  recordId: string | null;
  paystackStatus: string | null;
  paystackAmount: string | null;
  birrStatus: string | null;
  birrAmount: string | null;
  currency: string | null;
  detail: string;
  status: "open" | "resolved";
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolvedBy: { fullName: string } | null;
  run: { day: string };
}

const RUN_TONE = { clean: "success", issues: "warning", failed: "danger", running: "neutral" } as const;
const DIRECTION_LABEL = { in: "Money in", out: "Money out", refund: "Refund" } as const;

function yesterdayInLagos(): string {
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(lagosNow.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function side(status: string | null, amount: string | null, currency: string | null) {
  if (!status && !amount) return <span className="text-slate-400">No record</span>;
  return (
    <span>
      {status && <span className="font-medium text-slate-800">{humanize(status)}</span>}
      {amount && <span className="block text-xs tabular-nums text-slate-500">{formatMoney(amount, currency ?? "NGN")}</span>}
    </span>
  );
}

export default function PaymentReconciliationPage() {
  const { staff, can } = useStaffSession();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("open");

  const load = useCallback(() => {
    const query = new URLSearchParams({ status, ...(direction && { direction }) }).toString();
    Promise.all([apiFetchJson<Run[]>("/payment-reconciliation/runs"), apiFetchJson<Issue[]>(`/payment-reconciliation/issues?${query}`)])
      .then(([r, i]) => {
        setRuns(r);
        setIssues(i);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [status, direction]);
  useEffect(load, [load]);

  if (staff && !can("payments.reconciliation_view")) {
    return (
      <Alert tone="danger" title="Not available to your role">
        Payment reconciliation is for Compliance, the Audit Committee, the Board of Trustees and Mutawalli Officers.
      </Alert>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        title="Payment Reconciliation"
        description="Each day, Paystack's records of money in, money out and refunds are checked against Birr's. Mismatches are listed here; nothing is changed automatically."
      />

      {error && (
        <Alert tone="danger" title="Couldn't load reconciliation">
          {error}
        </Alert>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Recent runs</h2>
          {can("payments.reconciliation_run") && <RunDay onRan={load} />}
        </div>
        {!runs && !error && <RowsSkeleton columns={5} />}
        {runs && runs.length === 0 && <EmptyState title="No runs yet" description="The first check runs after 02:00 Lagos time, for the day before." />}
        {runs && runs.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Day</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell>Money in (Paystack · Birr)</TableHeaderCell>
                <TableHeaderCell>Money out</TableHeaderCell>
                <TableHeaderCell>Refunds</TableHeaderCell>
                <TableHeaderCell>Run by</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-slate-900">{formatDate(`${r.day}T12:00:00Z`)}</TableCell>
                  <TableCell>
                    <Badge tone={RUN_TONE[r.status]}>
                      {r.status === "issues" ? `${r.counts?.mismatches ?? 0} mismatch${r.counts?.mismatches === 1 ? "" : "es"}` : humanize(r.status)}
                    </Badge>
                    {r.status === "failed" && r.error && <span className="mt-1 block text-xs text-rose-700">{r.error}</span>}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.counts?.in ? `${r.counts.in.paystack} · ${r.counts.in.birr}` : "—"}</TableCell>
                  <TableCell className="tabular-nums">{r.counts?.out ? `${r.counts.out.paystack} · ${r.counts.out.birr}` : "—"}</TableCell>
                  <TableCell className="tabular-nums">{r.counts?.refunds ? `${r.counts.refunds.paystack} · ${r.counts.refunds.birr}` : "—"}</TableCell>
                  <TableCell className="text-slate-600">{r.trigger === "scheduler" ? "Daily check" : (r.startedBy?.fullName ?? "Staff")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-sm font-semibold text-slate-900">Mismatches</h2>
          <div>
            <label htmlFor="recon-status" className="mb-1 block text-xs font-medium text-slate-500">
              Show
            </label>
            <Select id="recon-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </Select>
          </div>
          <div>
            <label htmlFor="recon-direction" className="mb-1 block text-xs font-medium text-slate-500">
              Direction
            </label>
            <Select id="recon-direction" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">All</option>
              <option value="in">Money in</option>
              <option value="out">Money out</option>
              <option value="refund">Refunds</option>
            </Select>
          </div>
        </div>
        {!issues && !error && <RowsSkeleton columns={5} />}
        {issues && issues.length === 0 && <EmptyState title={status === "open" ? "No open mismatches" : "Nothing here"} description="Paystack and Birr agree for every day checked." />}
        {issues && issues.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>What</TableHeaderCell>
                <TableHeaderCell>Paystack</TableHeaderCell>
                <TableHeaderCell>Birr</TableHeaderCell>
                <TableHeaderCell className="text-right">Action</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {issues.map((i) => (
                <IssueRow key={i.id} issue={i} canResolve={can("payments.reconciliation_resolve")} onChanged={load} />
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function RunDay({ onRan }: { onRan: () => void }) {
  const [day, setDay] = useState(yesterdayInLagos());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetchJson("/payment-reconciliation/runs", { method: "POST", body: JSON.stringify({ day }) });
      onRan();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="recon-day" className="mb-1 block text-xs font-medium text-slate-500">
          Check a day
        </label>
        <Input id="recon-day" type="date" required value={day} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value)} />
      </div>
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "Checking Paystack…" : "Run now"}
      </Button>
      {error && <p className="w-full text-xs text-rose-700">{error}</p>}
    </form>
  );
}

function IssueRow({ issue, canResolve, onChanged }: { issue: Issue; canResolve: boolean; onChanged: () => void }) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"recheck" | "resolve" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function recheck() {
    setBusy("recheck");
    setMessage(null);
    try {
      const result = await apiFetchJson<{ birrStatusBefore: string | null; birrStatusNow: string | null }>(`/payment-reconciliation/issues/${issue.id}/recheck`, {
        method: "POST",
      });
      setMessage(
        result.birrStatusNow === result.birrStatusBefore
          ? `Paystack checked: still ${result.birrStatusNow ?? "unknown"} at Birr.`
          : `Paystack checked: now ${result.birrStatusNow} at Birr (was ${result.birrStatusBefore}).`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function resolve() {
    setBusy("resolve");
    setMessage(null);
    try {
      await apiFetchJson(`/payment-reconciliation/issues/${issue.id}/resolve`, { method: "POST", body: JSON.stringify({ note }) });
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {DIRECTION_LABEL[issue.direction]} · {formatDate(`${issue.run.day}T12:00:00Z`)}
        </span>
        <span className="mt-0.5 block text-sm text-slate-900">{issue.detail}</span>
        <span className="block break-all font-mono text-[11px] text-slate-400">{issue.providerReference}</span>
        {issue.status === "resolved" && (
          <span className="mt-1 block text-xs text-slate-600">
            Resolved by {issue.resolvedBy?.fullName ?? "staff"}
            {issue.resolvedAt ? ` on ${formatDate(issue.resolvedAt)}` : ""}: {issue.resolutionNote}
          </span>
        )}
        {message && <span className="mt-1 block text-xs text-slate-700">{message}</span>}
      </TableCell>
      <TableCell>{side(issue.paystackStatus, issue.paystackAmount, issue.currency)}</TableCell>
      <TableCell>{side(issue.birrStatus, issue.birrAmount, issue.currency)}</TableCell>
      <TableCell className="text-right">
        {canResolve && issue.status === "open" && (
          <div className="flex flex-col items-end gap-2">
            {issue.direction === "in" && issue.recordId && (
              <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" disabled={busy !== null} onClick={recheck}>
                {busy === "recheck" ? "Asking…" : "Ask Paystack again"}
              </Button>
            )}
            {!resolving ? (
              <button type="button" className="text-xs font-medium text-primary-700 hover:text-primary-800" onClick={() => setResolving(true)}>
                Mark resolved…
              </button>
            ) : (
              <div className="w-64 space-y-2 text-left">
                <label htmlFor={`note-${issue.id}`} className="block text-xs font-medium text-slate-700">
                  What was found, and what was done
                </label>
                <textarea
                  id={`note-${issue.id}`}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setResolving(false)} disabled={busy !== null}>
                    Cancel
                  </Button>
                  <Button type="button" className="px-2.5 py-1 text-xs" disabled={busy !== null || note.trim().length < 5} onClick={resolve}>
                    {busy === "resolve" ? "Saving…" : "Resolve"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
