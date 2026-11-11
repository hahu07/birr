"use client";

// Paying zakah out to the eight categories. Nothing here moves money on
// its own: a distribution is approved through zakah.distribution_approve
// (a Shariah board member or Compliance), paid by bank transfer from the
// zakah account, and only booked once a second person confirms that
// payment through zakah.distribution_mark_paid.
import { useCallback, useEffect, useState } from "react";
import { CLOSED_ZAKAH_CATEGORIES, ZAKAH_CATEGORIES, ZAKAH_CATEGORY_LABELS, type ZakahCategoryKey } from "@birr/zakah";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { Counterparty, ZakahDistributionRow, ZakahDistributionSummary, ZakahPool, ZakahRecipientRow } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconHeart,
  Input,
  Select,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../_components/ProposeGovernedAction";

const OPEN_CATEGORIES = ZAKAH_CATEGORIES.filter((c) => !CLOSED_ZAKAH_CATEGORIES.includes(c));
// Zakah al-Fitr goes to the poor and the needy only.
const FITR_CATEGORIES: ZakahCategoryKey[] = ["fuqara", "masakin"];
const POOLS: { value: ZakahPool; label: string }[] = [
  { value: "mal", label: "Zakah on wealth" },
  { value: "fitr_food", label: "Zakah al-Fitr — food" },
  { value: "fitr_cash", label: "Zakah al-Fitr — cash" },
];
const POOL_LABEL = Object.fromEntries(POOLS.map((p) => [p.value, p.label])) as Record<ZakahPool, string>;
const STATUS_TONE = { pending_approval: "warning", approved: "info", paid: "success", rejected: "neutral" } as const;
const STATUS_LABEL = { pending_approval: "awaiting approval", approved: "approved — to pay", paid: "paid", rejected: "rejected" } as const;

function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}

export default function ZakahDistributionsPage() {
  const [summary, setSummary] = useState<ZakahDistributionSummary | null>(null);
  const [distributions, setDistributions] = useState<ZakahDistributionRow[] | null>(null);
  const [recipients, setRecipients] = useState<ZakahRecipientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Each pool has its own limit; the page works on one at a time.
  const [pool, setPool] = useState<ZakahPool>("mal");

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<ZakahDistributionSummary>(`/zakah-distributions/summary?pool=${pool}`),
      apiFetchJson<ZakahDistributionRow[]>("/zakah-distributions"),
      apiFetchJson<ZakahRecipientRow[]>("/zakah-distributions/recipients"),
    ])
      .then(([s, d, r]) => {
        setSummary(s);
        setDistributions(d);
        setRecipients(r);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [pool]);
  useEffect(load, [load]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconHeart className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Zakah distributions</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Paying zakah to the eight categories, as each payer&apos;s agent. All of it reaches recipients — Birr takes no
            administrators&apos; share.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load zakah distributions" className="mb-6">
          {error}
        </Alert>
      )}

      <div className="mb-6 max-w-xs space-y-1.5">
        <label htmlFor="dist-pool-view" className="text-sm font-medium text-slate-700">Pool</label>
        <Select id="dist-pool-view" className="w-full" value={pool} onChange={(e) => setPool(e.target.value as ZakahPool)}>
          {POOLS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </div>
      {summary && <SummaryCards summary={summary} />}
      <DistributionsSection
        pool={pool}
        distributions={distributions === null ? null : distributions.filter((d) => (d.pool ?? "mal") === pool)}
        recipients={recipients}
        available={summary?.available ?? null}
        onChange={load}
      />
      <RecipientsSection recipients={recipients} onChange={load} />
    </div>
  );
}

function SummaryCards({ summary }: { summary: ZakahDistributionSummary }) {
  const waited = summary.oldestUndistributedSince ? daysSince(summary.oldestUndistributedSince) : null;
  const paidByCategory = summary.byCategory.filter((c) => c.status === "paid");
  return (
    <section className="mb-10">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Available to distribute" value={formatMoney(summary.available, summary.currency)} />
        <StatCard label="Committed, not yet paid" value={formatMoney(String(Number(summary.committed) - Number(summary.paid)), summary.currency)} />
        <StatCard label="Paid to recipients" value={formatMoney(summary.paid, summary.currency)} />
        <StatCard label="Oldest zakah waiting" value={waited === null ? "None" : `${waited} day${waited === 1 ? "" : "s"}`} />
      </div>
      {Number(summary.held ?? 0) > 0 && (
        <p className="mt-4 text-sm text-slate-600">On AML hold, not available to distribute: {formatMoney(summary.held!, summary.currency)}</p>
      )}
      {Number(summary.refunded) > 0 && (
        <p className="mt-4 text-sm text-slate-600">Refunded to payers (mistaken payments): {formatMoney(summary.refunded, summary.currency)}</p>
      )}
      {paidByCategory.length > 0 && (
        <p className="mt-4 text-sm text-slate-600">
          Paid so far:{" "}
          {paidByCategory.map((c, i) => (
            <span key={c.category}>
              {i > 0 && " · "}
              {ZAKAH_CATEGORY_LABELS[c.category]} {formatMoney(c.amount, summary.currency)}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function DistributionsSection({
  pool,
  distributions,
  recipients,
  available,
  onChange,
}: {
  distributions: ZakahDistributionRow[] | null;
  recipients: ZakahRecipientRow[] | null;
  available: string | null;
  onChange: () => void;
  pool: ZakahPool;
}) {
  const { can } = useStaffSession();
  const canCreate = can("zakah.distribution_create");
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="mb-10">
      <SectionHeader
        title="Distributions"
        description="A Mutawalli Officer proposes; a Shariah board member or Compliance approves. Finance pays approved ones by bank transfer from the zakah account, and a second person confirms the payment before it's booked."
        actionLabel={canCreate ? (showForm ? "Cancel" : "New distribution") : undefined}
        onAction={canCreate ? () => setShowForm((v) => !v) : undefined}
      />
      {canCreate && showForm && (
        <DistributionForm
          key={pool}
          pool={pool}
          recipients={(recipients ?? []).filter((r) => r.active)}
          available={available}
          onCreated={() => {
            setShowForm(false);
            onChange();
          }}
        />
      )}
      {distributions === null && <RowsSkeleton columns={5} />}
      {distributions !== null && distributions.length === 0 && (
        <EmptyState title="No distributions yet" description="Register an eligible recipient, then create a distribution for approval." />
      )}
      {distributions !== null && distributions.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Payee</TableHeaderCell>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {distributions.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <div className="font-medium text-slate-900">{d.recipient?.name ?? d.counterparty?.name}</div>
                  <div className="max-w-xs truncate text-xs text-slate-500" title={d.reason}>
                    {d.counterparty ? "Partner · " : ""}
                    {d.reason}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-slate-600">{ZAKAH_CATEGORY_LABELS[d.category]}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(d.amount, d.currency)}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                  {d.paidOn && (
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDate(d.paidOn)} · ref {d.bankReference}
                    </div>
                  )}
                  {d.partnerReportedAt && <div className="mt-1 text-xs text-slate-500">Reached {d.partnerReachedCount} people</div>}
                </TableCell>
                <TableCell>
                  <RowActions distribution={d} onChange={onChange} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function RowActions({ distribution: d, onChange }: { distribution: ZakahDistributionRow; onChange: () => void }) {
  const { can } = useStaffSession();
  const [open, setOpen] = useState<"pay" | "report" | null>(null);

  if (d.status === "pending_approval" && can("zakah.distribution_approve")) {
    return (
      <ProposeGovernedActionButton permissionKey="zakah.distribution_approve" payload={{ distributionId: d.id }} label="Propose for approval" onProposed={onChange} />
    );
  }
  if (d.status === "approved" && can("zakah.distribution_mark_paid")) {
    return open === "pay" ? (
      <RecordPaymentForm distribution={d} onDone={onChange} onCancel={() => setOpen(null)} />
    ) : (
      <div className="flex flex-wrap justify-end gap-2">
        {d.recipient && can("zakah.recipient_manage") && <BankDetailsButton recipientId={d.recipient.id} />}
        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen("pay")}>
          Record payment
        </Button>
      </div>
    );
  }
  if (d.status === "paid" && d.counterparty && !d.partnerReportedAt && can("zakah.distribution_create")) {
    return open === "report" ? (
      <PartnerReportForm distributionId={d.id} onDone={onChange} onCancel={() => setOpen(null)} />
    ) : (
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen("report")}>
        Record partner report
      </Button>
    );
  }
  return null;
}

function BankDetailsButton({ recipientId }: { recipientId: string }) {
  const [details, setDetails] = useState<{ bankName: string; accountNumber: string; accountName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (details) {
    return (
      <span className="text-xs text-slate-700">
        {details.accountName} · {details.bankName} · <span className="font-mono">{details.accountNumber}</span>
      </span>
    );
  }
  return (
    <div>
      <Button
        variant="secondary"
        className="px-2.5 py-1.5 text-xs"
        onClick={() =>
          apiFetchJson<typeof details>(`/zakah-distributions/recipients/${recipientId}/bank-details`)
            .then(setDetails)
            .catch((err: unknown) => setError(errorText(err)))
        }
      >
        Show bank details
      </Button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

function RecordPaymentForm({ distribution, onDone, onCancel }: { distribution: ZakahDistributionRow; onDone: () => void; onCancel: () => void }) {
  const [bankReference, setBankReference] = useState("");
  const [paidOn, setPaidOn] = useState(lagosToday());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "zakah.distribution_mark_paid", payload: { distributionId: distribution.id, bankReference, paidOn } }),
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 text-left">
      <div>
        <label htmlFor={`ref-${distribution.id}`} className="mb-1 block text-xs font-medium text-slate-700">Bank reference</label>
        <Input id={`ref-${distribution.id}`} required minLength={3} maxLength={100} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`paid-${distribution.id}`} className="mb-1 block text-xs font-medium text-slate-700">Paid on</label>
        <Input id={`paid-${distribution.id}`} type="date" required max={lagosToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="px-2.5 py-1.5 text-xs" disabled={submitting}>
          {submitting ? "Sending…" : "Send for confirmation"}
        </Button>
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PartnerReportForm({ distributionId, onDone, onCancel }: { distributionId: string; onDone: () => void; onCancel: () => void }) {
  const [reachedCount, setReachedCount] = useState("");
  const [report, setReport] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetchJson(`/zakah-distributions/${distributionId}/partner-report`, {
        method: "POST",
        body: JSON.stringify({ reachedCount: Number(reachedCount), report }),
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 text-left">
      <div>
        <label htmlFor={`reached-${distributionId}`} className="mb-1 block text-xs font-medium text-slate-700">People reached</label>
        <Input id={`reached-${distributionId}`} type="number" min={1} required value={reachedCount} onChange={(e) => setReachedCount(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`report-${distributionId}`} className="mb-1 block text-xs font-medium text-slate-700">What the partner reported</label>
        <Input id={`report-${distributionId}`} required minLength={10} value={report} onChange={(e) => setReport(e.target.value)} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="px-2.5 py-1.5 text-xs">Save report</Button>
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DistributionForm({
  pool,
  recipients,
  available,
  onCreated,
}: {
  pool: ZakahPool;
  recipients: ZakahRecipientRow[];
  available: string | null;
  onCreated: () => void;
}) {
  const { can } = useStaffSession();
  const [payee, setPayee] = useState<"recipient" | "partner">("recipient");
  const [recipientId, setRecipientId] = useState("");
  const [partners, setPartners] = useState<Counterparty[] | null>(null);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [category, setCategory] = useState<ZakahCategoryKey | "">("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (payee === "partner" && partners === null) {
      apiFetchJson<Counterparty[]>("/counterparties?status=active")
        .then(setPartners)
        .catch((err: unknown) => setError(errorText(err)));
    }
  }, [payee, partners]);

  const recipient = recipients.find((r) => r.id === recipientId);
  const allowed = pool === "mal" ? OPEN_CATEGORIES : FITR_CATEGORIES;
  const categories = (payee === "recipient" ? (recipient?.categories ?? []) : OPEN_CATEGORIES).filter((c) => allowed.includes(c));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiFetchJson<{ id: string }>("/zakah-distributions", {
        method: "POST",
        body: JSON.stringify({
          ...(payee === "recipient" ? { recipientId } : { counterpartyId }),
          pool,
          category,
          amount: amount.replace(/[,\s₦]/g, ""),
          reason,
        }),
      });
      // Send it straight for approval when this officer may; otherwise it
      // waits in the list with its own "Propose for approval" button.
      if (can("zakah.distribution_approve")) {
        await apiFetchJson("/governed-actions", {
          method: "POST",
          body: JSON.stringify({ permissionKey: "zakah.distribution_approve", payload: { distributionId: created.id } }),
        }).catch(() => undefined);
      }
      onCreated();
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't create this distribution">
          {error}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="dist-payee" className="text-sm font-medium text-slate-700">Pay to</label>
          <Select id="dist-payee" className="w-full" value={payee} onChange={(e) => { setPayee(e.target.value as "recipient" | "partner"); setCategory(""); }}>
            <option value="recipient">A verified individual</option>
            <option value="partner">A vetted partner organisation</option>
          </Select>
        </div>
        {payee === "recipient" ? (
          <div className="space-y-1.5">
            <label htmlFor="dist-recipient" className="text-sm font-medium text-slate-700">Recipient</label>
            <Select id="dist-recipient" className="w-full" required value={recipientId} onChange={(e) => { setRecipientId(e.target.value); setCategory(""); }}>
              <option value="">Choose…</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="dist-partner" className="text-sm font-medium text-slate-700">Partner</label>
            <Select id="dist-partner" className="w-full" required value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
              <option value="">{partners === null ? "Loading…" : "Choose…"}</option>
              {(partners ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="dist-category" className="text-sm font-medium text-slate-700">Category</label>
          <Select id="dist-category" className="w-full" required value={category} onChange={(e) => setCategory(e.target.value as ZakahCategoryKey)}>
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c} value={c}>{ZAKAH_CATEGORY_LABELS[c]}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="dist-amount" className="text-sm font-medium text-slate-700">Amount (₦)</label>
          <Input id="dist-amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {available !== null && (
            <p className="text-xs text-slate-500">
              {formatMoney(available, "NGN")} available in {POOL_LABEL[pool].toLowerCase()}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="dist-reason" className="text-sm font-medium text-slate-700">Why this payment fits this category</label>
        <Input id="dist-reason" required minLength={10} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create and send for approval"}
      </Button>
    </form>
  );
}

function RecipientsSection({ recipients, onChange }: { recipients: ZakahRecipientRow[] | null; onChange: () => void }) {
  const { can } = useStaffSession();
  const canManage = can("zakah.recipient_manage");
  const [showForm, setShowForm] = useState(false);

  return (
    <section>
      <SectionHeader
        title="Recipients"
        description="People Birr has verified as eligible for zakah, and why. Each payment to them is approved separately."
        actionLabel={canManage ? (showForm ? "Cancel" : "Register a recipient") : undefined}
        onAction={canManage ? () => setShowForm((v) => !v) : undefined}
      />
      {canManage && showForm && (
        <RecipientForm
          onCreated={() => {
            setShowForm(false);
            onChange();
          }}
        />
      )}
      {recipients === null && <RowsSkeleton columns={3} />}
      {recipients !== null && recipients.length === 0 && <EmptyState title="No recipients yet" description="Register people Birr has verified as eligible." />}
      {recipients !== null && recipients.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Eligible as</TableHeaderCell>
              <TableHeaderCell>Bank</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recipients.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium text-slate-900">
                    {r.name} {!r.active && <Badge tone="neutral">inactive</Badge>}
                  </div>
                  <div className="max-w-xs truncate text-xs text-slate-500" title={r.eligibilityReason}>{r.eligibilityReason}</div>
                </TableCell>
                <TableCell className="text-sm text-slate-600">{r.categories.map((c) => ZAKAH_CATEGORY_LABELS[c]).join("; ")}</TableCell>
                <TableCell className="text-sm text-slate-600">{r.bank ? `${r.bank.bankName} ····${r.bank.accountLast4}` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function RecipientForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [categories, setCategories] = useState<ZakahCategoryKey[]>([]);
  const [eligibilityReason, setEligibilityReason] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(c: ZakahCategoryKey) {
    setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/zakah-distributions/recipients", {
        method: "POST",
        body: JSON.stringify({
          name,
          categories,
          eligibilityReason,
          phone: phone || undefined,
          bankName: bankName || undefined,
          accountNumber: accountNumber || undefined,
          accountName: accountName || undefined,
        }),
      });
      onCreated();
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't register this recipient">
          {error}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="rec-name" className="text-sm font-medium text-slate-700">Full name</label>
          <Input id="rec-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rec-phone" className="text-sm font-medium text-slate-700">Phone (optional)</label>
          <Input id="rec-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Eligible as</legend>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {OPEN_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={categories.includes(c)} onChange={() => toggle(c)} />
              {ZAKAH_CATEGORY_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor="rec-reason" className="text-sm font-medium text-slate-700">Why they qualify</label>
        <Input id="rec-reason" required minLength={10} value={eligibilityReason} onChange={(e) => setEligibilityReason(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="rec-bank" className="text-sm font-medium text-slate-700">Bank</label>
          <Input id="rec-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rec-account" className="text-sm font-medium text-slate-700">Account number</label>
          <Input id="rec-account" inputMode="numeric" pattern="\d{10}" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rec-account-name" className="text-sm font-medium text-slate-700">Account name</label>
          <Input id="rec-account-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </div>
      </div>
      <Button type="submit" disabled={submitting || categories.length === 0}>
        {submitting ? "Registering…" : "Register recipient"}
      </Button>
    </form>
  );
}
