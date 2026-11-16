"use client";

// Monthly giving (RecurringGift, 2026-11-15): Vault gifts, founders'
// Waqf Fund top-ups and monthly zakah. Visible with giving.monthly_view;
// Compliance (giving.monthly_cancel) can stop a gift with a reason, which
// is kept in the audit trail and never shown to the giver.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney, humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import { Alert, Badge, Button, EmptyState, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";

type Status = "pending_setup" | "active" | "paused" | "cancelled" | "ended";
type Kind = "vault" | "waqf" | "zakah";

interface MonthlyGiftRow {
  id: string;
  kind: Kind;
  status: Status;
  pauseReason: string | null;
  email: string | null;
  whatsappNumber: string | null;
  amount: string;
  currency: string;
  dayOfMonth: number;
  nextPeriod: string;
  nextChargeAt: string | null;
  failedAttempts: number;
  card: { last4: string; brand: string | null; expMonth: number | null; expYear: number | null } | null;
  target: { name: string; detail?: string };
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  endedReason: string | null;
}

interface MonthlyGiftDetail extends MonthlyGiftRow {
  charges: { id: string; period: string | null; amount: string; status: "pending" | "confirmed" | "failed"; createdAt: string }[];
  history: { action: string; actorType: string; createdAt: string }[];
}

const KIND_LABEL: Record<Kind, string> = { vault: "Vault gift", waqf: "Waqf top-up", zakah: "Zakah (in advance)" };
const STATUS_TONE: Record<Status, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  paused: "warning",
  pending_setup: "neutral",
  cancelled: "neutral",
  ended: "neutral",
};
const PAUSE_LABEL: Record<string, string> = {
  card_failed: "card declined",
  card_expired: "card expired",
  needs_identity: "needs ID",
  terms_changed: "terms changed",
  below_minimum: "below minimum",
};

function statusLabel(row: MonthlyGiftRow): string {
  if (row.status === "paused" && row.pauseReason) return `Paused · ${PAUSE_LABEL[row.pauseReason] ?? humanize(row.pauseReason)}`;
  if (row.status === "pending_setup") return "Starting";
  return humanize(row.status);
}

export default function MonthlyGivingPage() {
  const { staff, can } = useStaffSession();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState<MonthlyGiftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = new URLSearchParams({ ...(status && { status }), ...(kind && { kind }) }).toString();
    setRows(null);
    apiFetchJson<MonthlyGiftRow[]>(`/recurring-gifts${query ? `?${query}` : ""}`)
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [status, kind]);
  useEffect(load, [load]);

  if (staff && !can("giving.monthly_view")) {
    return (
      <Alert tone="danger" title="Not available to your role">
        Monthly giving is for Compliance, the Audit Committee, the Board of Trustees and Mutawalli Officers.
      </Alert>
    );
  }

  const active = rows?.filter((r) => r.status === "active") ?? [];
  const monthlyTotal = active.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Monthly Giving"
        description="Vault gifts, Waqf Fund top-ups and zakah charged to a saved card each month, in naira."
      />

      {error && (
        <Alert tone="danger" title="Couldn't load monthly giving">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="monthly-status" className="mb-1 block text-xs font-medium text-slate-500">
            Status
          </label>
          <Select id="monthly-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="pending_setup">Starting</option>
            <option value="cancelled">Cancelled</option>
            <option value="ended">Ended</option>
          </Select>
        </div>
        <div>
          <label htmlFor="monthly-kind" className="mb-1 block text-xs font-medium text-slate-500">
            Kind
          </label>
          <Select id="monthly-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="vault">Vault gifts</option>
            <option value="waqf">Waqf top-ups</option>
            <option value="zakah">Zakah</option>
          </Select>
        </div>
        {rows && active.length > 0 && (
          <p className="ml-auto text-sm text-slate-600">
            {active.length} active · <span className="font-semibold tabular-nums text-slate-900">{formatMoney(monthlyTotal, "NGN", { decimals: 0 })}</span> a month
          </p>
        )}
      </div>

      {!rows && !error && <RowsSkeleton columns={6} />}
      {rows && rows.length === 0 && <EmptyState title="No monthly gifts" description="Nothing matches these filters." />}
      {rows && rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Giver</TableHeaderCell>
              <TableHeaderCell>For</TableHeaderCell>
              <TableHeaderCell>A month</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Next charge</TableHeaderCell>
              <TableHeaderCell>Card</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => setSelected(selected === row.id ? null : row.id)}
                className={`cursor-pointer ${selected === row.id ? "bg-primary-50/60" : "hover:bg-slate-50"}`}
              >
                <TableCell>
                  <span className="font-medium text-slate-900">{row.email ?? row.whatsappNumber}</span>
                  <span className="block text-xs text-slate-500">{KIND_LABEL[row.kind]}</span>
                </TableCell>
                <TableCell>
                  {row.target.name}
                  {row.target.detail && <span className="block text-xs text-slate-500">{row.target.detail}</span>}
                </TableCell>
                <TableCell className="tabular-nums">{formatMoney(row.amount, row.currency, { decimals: 0 })}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[row.status]}>{statusLabel(row)}</Badge>
                </TableCell>
                <TableCell>{row.status === "active" && row.nextChargeAt ? formatDate(row.nextChargeAt) : "—"}</TableCell>
                <TableCell>{row.card ? `${row.card.brand ? humanize(row.card.brand) : "Card"} ·${row.card.last4}` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected && <GiftDetail id={selected} canCancel={can("giving.monthly_cancel")} onChanged={load} />}
    </div>
  );
}

function GiftDetail({ id, canCancel, onChanged }: { id: string; canCancel: boolean; onChanged: () => void }) {
  const [gift, setGift] = useState<MonthlyGiftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGift(null);
    setConfirming(false);
    setReason("");
    apiFetchJson<MonthlyGiftDetail>(`/recurring-gifts/${id}`)
      .then(setGift)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      setGift(await apiFetchJson<MonthlyGiftDetail>(`/recurring-gifts/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }));
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert tone="danger" title="Couldn't load this monthly gift">{error}</Alert>;
  if (!gift) return <RowsSkeleton columns={3} />;
  const running = gift.status === "active" || gift.status === "paused";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{KIND_LABEL[gift.kind]}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formatMoney(gift.amount, gift.currency, { decimals: 0 })} a month · {gift.target.name}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {[gift.email, gift.whatsappNumber].filter(Boolean).join(" · ")} · on the {gift.dayOfMonth}
            {gift.dayOfMonth === 1 ? "st" : gift.dayOfMonth === 2 ? "nd" : gift.dayOfMonth === 3 ? "rd" : "th"} · since {formatDate(gift.createdAt)}
            {gift.failedAttempts > 0 && gift.status === "active" && ` · ${gift.failedAttempts} declined this month`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[gift.status]}>{statusLabel(gift)}</Badge>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-900">Payments</p>
          {gift.charges.length === 0 ? (
            <p className="text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {gift.charges.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2">
                  <span className="text-slate-700">{c.period ?? "Card update"} · {formatDate(c.createdAt)}</span>
                  <span className="flex gap-3">
                    <span className="tabular-nums">{formatMoney(c.amount, gift.currency, { decimals: 0 })}</span>
                    <Badge tone={c.status === "confirmed" ? "success" : c.status === "failed" ? "danger" : "neutral"}>{humanize(c.status)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-900">History</p>
          <ul className="space-y-1.5 text-sm">
            {gift.history.map((h, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-slate-700">{humanize(h.action.replace("recurring_gift.", ""))}</span>
                <span className="text-slate-500">
                  {humanize(h.actorType)} · {formatDate(h.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {canCancel && running && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          {!confirming ? (
            <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
              Stop this monthly gift
            </Button>
          ) : (
            <div className="space-y-3">
              <label htmlFor="cancel-reason" className="block text-sm font-medium text-slate-800">
                Reason (kept in the audit trail; the giver is told only that it has ended)
              </label>
              <textarea
                maxLength={1000}
                id="cancel-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              <div className="flex gap-3">
                <Button type="button" variant="danger" disabled={busy || reason.trim().length < 10} onClick={cancel}>
                  {busy ? "Stopping…" : "Stop it"}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
