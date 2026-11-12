"use client";

// Refunding zakah paid by mistake. Compliance requests it from a payment
// row and proposes it (zakah.refund_approve, approved by the Board); a
// Mutawalli Officer pays it by bank transfer from the zakah account and
// records the reference (zakah.refund_mark_paid), which a second person
// confirms before it's booked. Only the zakah is refunded, never the fee
// cover, and never zakah already committed to recipients.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { ZakahPaymentRow, ZakahRefundRow } from "../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../_components/ProposeGovernedAction";

const REASONS = [
  { value: "duplicate_payment", label: "Paid twice by mistake" },
  { value: "wrong_amount", label: "Paid the wrong amount" },
  { value: "unauthorised_payment", label: "Payer didn't authorise it" },
] as const;
const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.value, r.label])) as Record<ZakahRefundRow["reason"], string>;
const STATUS_TONE = { pending_approval: "warning", approved: "info", paid: "success", rejected: "neutral" } as const;
const STATUS_LABEL = { pending_approval: "awaiting Board approval", approved: "approved — to pay", paid: "refunded", rejected: "rejected" } as const;

function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** "Refund" on a confirmed payment's row — a small form, for Compliance only. */
export function RefundButton({ payment, onRequested }: { payment: ZakahPaymentRow; onRequested: () => void }) {
  const { can } = useStaffSession();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(payment.amount);
  const [reason, setReason] = useState<ZakahRefundRow["reason"]>("duplicate_payment");
  const [details, setDetails] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (payment.status !== "confirmed" || !can("zakah.refund_request")) return null;
  if (!open) {
    return (
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
        Refund
      </Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const refund = await apiFetchJson<{ id: string }>("/zakah-refunds", {
        method: "POST",
        body: JSON.stringify({ paymentId: payment.id, amount: amount.replace(/[,\s₦]/g, ""), reason, details, bankName, accountNumber, accountName }),
      });
      // Straight to the Board when this person may propose it; otherwise
      // it waits in the refunds list with its own button.
      if (can("zakah.refund_approve")) {
        await apiFetchJson("/governed-actions", {
          method: "POST",
          body: JSON.stringify({ permissionKey: "zakah.refund_approve", payload: { refundId: refund.id } }),
        }).catch(() => undefined);
      }
      setOpen(false);
      onRequested();
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-72 space-y-2 text-left">
      <p className="text-xs text-slate-500">Refunds are for mistakes only. The processing fee a payer added isn&apos;t refunded.</p>
      <div>
        <label htmlFor={`rf-amount-${payment.id}`} className="mb-1 block text-xs font-medium text-slate-700">Zakah to refund (₦)</label>
        <Input id={`rf-amount-${payment.id}`} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`rf-reason-${payment.id}`} className="mb-1 block text-xs font-medium text-slate-700">Reason</label>
        <Select id={`rf-reason-${payment.id}`} className="w-full" value={reason} onChange={(e) => setReason(e.target.value as ZakahRefundRow["reason"])}>
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={`rf-details-${payment.id}`} className="mb-1 block text-xs font-medium text-slate-700">What happened</label>
        <Input id={`rf-details-${payment.id}`} required minLength={10} value={details} onChange={(e) => setDetails(e.target.value)} />
      </div>
      <p className="pt-1 text-xs font-medium text-slate-700">Payer&apos;s bank account for the refund</p>
      <div>
        <label htmlFor={`rf-bank-${payment.id}`} className="mb-1 block text-xs text-slate-700">Bank</label>
        <Input id={`rf-bank-${payment.id}`} required value={bankName} onChange={(e) => setBankName(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`rf-acct-${payment.id}`} className="mb-1 block text-xs text-slate-700">Account number</label>
        <Input id={`rf-acct-${payment.id}`} required inputMode="numeric" pattern="\d{10}" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`rf-name-${payment.id}`} className="mb-1 block text-xs text-slate-700">Account name</label>
        <Input id={`rf-name-${payment.id}`} required value={accountName} onChange={(e) => setAccountName(e.target.value)} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="px-2.5 py-1.5 text-xs" disabled={submitting}>
          {submitting ? "Sending…" : "Send to the Board"}
        </Button>
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RefundsSection({ refreshKey }: { refreshKey: number }) {
  const [refunds, setRefunds] = useState<ZakahRefundRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    apiFetchJson<ZakahRefundRow[]>("/zakah-refunds")
      .then(setRefunds)
      .catch((err: unknown) => setError(errorText(err)));
  }, [refreshKey, reload]);

  return (
    <section className="mb-10">
      <SectionHeader
        title="Refunds"
        description="Zakah paid by mistake, paid back by bank transfer from the zakah account. Compliance requests; the Board approves; a second person confirms the payment."
      />
      {error && (
        <Alert tone="danger" title="Couldn't load refunds" className="mb-4">
          {error}
        </Alert>
      )}
      {!error && refunds === null && <RowsSkeleton columns={4} />}
      {refunds !== null && refunds.length === 0 && <EmptyState title="No refunds" description="Start one from a confirmed payment above." />}
      {refunds !== null && refunds.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Payer</TableHeaderCell>
              <TableHeaderCell>Refund</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {refunds.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium text-slate-900">{r.payment.payer?.fullName ?? r.payment.payer?.email ?? "Anonymous"}</div>
                  <div className="max-w-xs truncate text-xs text-slate-500" title={r.details}>
                    {REASON_LABEL[r.reason]} · {r.details}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatMoney(r.amount, r.currency)}
                  <div className="text-xs text-slate-500">of {formatMoney(r.payment.amount, r.currency)} paid</div>
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  {r.paidOn && (
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDate(r.paidOn)} · ref {r.bankReference}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <RefundRowActions refund={r} onChange={() => setReload((n) => n + 1)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function RefundRowActions({ refund: r, onChange }: { refund: ZakahRefundRow; onChange: () => void }) {
  const { can } = useStaffSession();
  const [paying, setPaying] = useState(false);
  const [details, setDetails] = useState<{ bankName: string; accountNumber: string; accountName: string } | null>(null);
  const [bankReference, setBankReference] = useState("");
  const [paidOn, setPaidOn] = useState(lagosToday());
  const [error, setError] = useState<string | null>(null);

  if (r.status === "pending_approval" && can("zakah.refund_approve")) {
    return <ProposeGovernedActionButton permissionKey="zakah.refund_approve" payload={{ refundId: r.id }} label="Send to the Board" onProposed={onChange} />;
  }
  if (r.status !== "approved" || !can("zakah.refund_mark_paid")) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "zakah.refund_mark_paid", payload: { refundId: r.id, bankReference, paidOn } }),
      });
      onChange();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="space-y-2 text-left">
      {details ? (
        <p className="text-xs text-slate-700">
          {details.accountName} · {details.bankName} · <span className="font-mono">{details.accountNumber}</span>
        </p>
      ) : (
        <Button
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          onClick={() =>
            apiFetchJson<typeof details>(`/zakah-refunds/${r.id}/bank-details`)
              .then(setDetails)
              .catch((err: unknown) => setError(errorText(err)))
          }
        >
          Show payer&apos;s bank details
        </Button>
      )}
      {paying ? (
        <form onSubmit={submit} className="space-y-2">
          <div>
            <label htmlFor={`rfp-ref-${r.id}`} className="mb-1 block text-xs font-medium text-slate-700">Bank reference</label>
            <Input id={`rfp-ref-${r.id}`} required minLength={3} maxLength={100} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`rfp-date-${r.id}`} className="mb-1 block text-xs font-medium text-slate-700">Paid on</label>
            <Input id={`rfp-date-${r.id}`} type="date" required max={lagosToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <Button type="submit" className="px-2.5 py-1.5 text-xs">Send for confirmation</Button>
        </form>
      ) : (
        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setPaying(true)}>
          Record refund payment
        </Button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
