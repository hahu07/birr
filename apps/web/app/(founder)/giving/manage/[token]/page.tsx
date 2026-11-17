"use client";

// A Vault, zakah or clinic waqf giver managing their monthly gift from the private
// link we email them (RecurringGiftsService; GET/POST /giving/manage/:token).
// No account: the token in the link is the credential, so the page never
// shows more than the giver already knows (the card's last four digits).
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, apiFetchJson } from "../../../../../lib/api";
import { formatMoney, humanize } from "../../../../../lib/format";
import { Alert, Button, Card, IconCheckCircle, IconShieldCheck, Input, Select, Skeleton } from "@birr/ui";
import { MoneyInput } from "../../../_components/form";

interface ManagedGift {
  kind: "vault" | "zakah" | "waqf" | "programme";
  status: "pending_setup" | "active" | "paused" | "cancelled" | "ended";
  pauseReason: "card_failed" | "card_expired" | "needs_identity" | "terms_changed" | "below_minimum" | null;
  email: string;
  amount: string;
  currency: string;
  dayOfMonth: number;
  nextChargeAt: string | null;
  card: { last4: string; brand: string | null; expMonth: number | null; expYear: number | null } | null;
  cardUpdateInProgress: boolean;
  target: { name: string; detail?: string; link?: string };
  minimumAmount: string;
  charges: { id: string; period: string | null; amount: string; status: "pending" | "confirmed" | "failed"; date: string }[];
  cancelledAt: string | null;
  endedReason: string | null;
  /** A monthly clinic endowment gift paused for a newly approved deed: the deed to read and accept. */
  newDeed?: { id: string; version: number; text: string; textHash: string } | null;
}

const ID_TYPES = ["national_id", "passport", "drivers_license", "other"] as const;

const ENDED_REASONS: Record<string, string> = {
  vault_closed: "the Vault has closed",
  cause_removed: "the cause you chose is no longer part of the Vault",
  card_not_reusable: "the card used can't be charged again automatically",
  setup_not_completed: "the first payment wasn't completed",
  clinic_closed: "the clinic isn't taking gifts",
};

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
}

function formatPeriod(period: string | null, fallbackIso: string): string {
  const [year, month] = (period ?? "").split("-").map(Number);
  const date = period ? new Date(Date.UTC(year, month - 1, 15)) : new Date(fallbackIso);
  return new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(date);
}

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

function StatusBadge({ gift }: { gift: ManagedGift }) {
  const styles: Record<ManagedGift["status"], [string, string]> = {
    active: ["Active", "bg-primary-50 text-primary-800 ring-primary-200"],
    paused: ["Paused", "bg-amber-50 text-amber-900 ring-amber-200"],
    pending_setup: ["Starting", "bg-slate-100 text-slate-700 ring-slate-200"],
    cancelled: ["Cancelled", "bg-slate-100 text-slate-700 ring-slate-200"],
    ended: ["Ended", "bg-slate-100 text-slate-700 ring-slate-200"],
  };
  const [label, cls] = styles[gift.status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${cls}`}>{label}</span>;
}

export default function ManageMonthlyGiftPage() {
  const { token } = useParams<{ token: string }>();
  const [gift, setGift] = useState<ManagedGift | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<ManagedGift>(`/giving/manage/${token}`)
      .then(setGift)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setInvalid(true);
        else setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      });
  }, [token]);

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:py-14">
      {invalid && (
        <Card>
          <p className="text-base font-semibold text-slate-900">This link isn&apos;t valid</p>
          <p className="mt-1.5 text-sm text-slate-600">
            It may be an older link: each time new links are sent, the old ones stop working.
          </p>
          <Link href="/giving/manage" className="mt-4 inline-block text-sm font-semibold text-primary-700 hover:text-primary-800">
            Email me my links →
          </Link>
        </Card>
      )}
      {loadError && (
        <Alert tone="danger" title="We couldn't load your monthly gift">
          {loadError}
        </Alert>
      )}
      {!invalid && !loadError && !gift && <Skeleton className="h-96 w-full" />}
      {gift && <GiftPanel token={token} gift={gift} onChange={setGift} />}
    </div>
  );
}

function GiftPanel({ token, gift, onChange }: { token: string; gift: ManagedGift; onChange: (gift: ManagedGift) => void }) {
  const running = gift.status === "active" || gift.status === "paused";
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-primary-700 via-primary-500 to-accent-500" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {gift.kind === "zakah" ? "Your monthly zakah" : "Your monthly gift"}
            </p>
            <StatusBadge gift={gift} />
          </div>
          <p className="font-display mt-3 text-4xl font-medium tracking-tight text-slate-900 tabular-nums">
            {formatMoney(gift.amount, gift.currency, { decimals: 0 })}
            <span className="ml-1.5 text-base font-normal text-slate-500">a month</span>
          </p>
          <p className="mt-1.5 text-sm text-slate-600">
            {gift.kind === "zakah" ? "Towards your zakah, paid in advance" : "To "}
            {gift.kind !== "zakah" &&
              (gift.target.link ? (
                <Link href={gift.target.link} className="font-semibold text-primary-700 hover:text-primary-800">
                  {gift.target.name}
                </Link>
              ) : (
                <span className="font-semibold text-slate-900">{gift.target.name}</span>
              ))}
            {gift.target.detail && <span className="text-slate-500"> · {gift.target.detail}</span>}
          </p>

          <dl className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-500">{gift.status === "active" ? "Next charge" : "Repeats on"}</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {gift.status === "active" && gift.nextChargeAt ? formatDay(gift.nextChargeAt) : `The ${ordinal(gift.dayOfMonth)} of each month`}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Card</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {gift.card ? (
                  <>
                    {gift.card.brand ? humanize(gift.card.brand) : "Card"} ending {gift.card.last4}
                    {gift.card.expMonth && gift.card.expYear && (
                      <span className="font-normal text-slate-500">
                        {" "}
                        · {String(gift.card.expMonth).padStart(2, "0")}/{String(gift.card.expYear).slice(-2)}
                      </span>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>

          {gift.status === "cancelled" && (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              Cancelled{gift.cancelledAt ? ` on ${formatDay(gift.cancelledAt)}` : ""}. No further payments will be taken. Thank you
              for everything you gave.
            </p>
          )}
          {gift.status === "ended" && (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              This monthly gift has ended{gift.endedReason && ENDED_REASONS[gift.endedReason] ? `: ${ENDED_REASONS[gift.endedReason]}` : ""}. No
              further payments will be taken.
            </p>
          )}
        </div>
      </div>

      {gift.status === "paused" && <PausedAction token={token} gift={gift} onChange={onChange} />}
      {running && <ChangeAmount token={token} gift={gift} onChange={onChange} />}
      {gift.charges.length > 0 && <History gift={gift} />}
      {running && <CancelGift token={token} gift={gift} onChange={onChange} />}

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500">
        <IconShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" />
        This page is private to you. Anyone with this link can manage the gift, so don&apos;t share it. Your card is held by Paystack;
        Birr never sees its full number.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PausedAction({ token, gift, onChange }: { token: string; gift: ManagedGift; onChange: (gift: ManagedGift) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number]>("national_id");
  const [idNumber, setIdNumber] = useState("");

  async function updateCard() {
    setBusy(true);
    setError(null);
    try {
      const { checkoutUrl } = await apiFetchJson<{ checkoutUrl: string }>(`/giving/manage/${token}/card`, { method: "POST" });
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(
        await apiFetchJson<ManagedGift>(`/giving/manage/${token}/identity`, {
          method: "POST",
          body: JSON.stringify({ fullName, idType, idNumber }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const amount = formatMoney(gift.amount, gift.currency, { decimals: 0 });
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 sm:p-6">
      {error && (
        <Alert tone="danger" title="That didn't work" className="mb-4">
          {error}
        </Alert>
      )}
      {(gift.pauseReason === "card_failed" || gift.pauseReason === "card_expired") && (
        <>
          <p className="text-sm font-semibold text-amber-950">
            {gift.pauseReason === "card_expired" ? "Your card has expired" : "We couldn't charge your card"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            Add a card to carry on. This month&apos;s {amount} will be charged to the new card now, and it will be used from then on.
          </p>
          <Button type="button" className="mt-4" disabled={busy || gift.cardUpdateInProgress} onClick={updateCard}>
            {busy ? "Opening checkout…" : gift.cardUpdateInProgress ? "Card update in progress" : "Update card"}
          </Button>
        </>
      )}
      {gift.pauseReason === "needs_identity" && (
        <form onSubmit={submitIdentity}>
          <p className="text-sm font-semibold text-amber-950">We need your name and ID to carry on</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            Your giving has reached the level where Nigerian law requires us to record who you are. Your ID is encrypted and never shown
            publicly.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="identity-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                Full name
              </label>
              <Input check="name" id="identity-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="identity-type" className="mb-1.5 block text-sm font-medium text-slate-700">
                ID type
              </label>
              <Select id="identity-type" className="w-full" value={idType} onChange={(e) => setIdType(e.target.value as (typeof ID_TYPES)[number])}>
                {ID_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "national_id" ? "National ID (NIN)" : humanize(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="identity-number" className="mb-1.5 block text-sm font-medium text-slate-700">
                ID number
              </label>
              <Input check="reference" id="identity-number" required value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </div>
          </div>
          <Button type="submit" className="mt-4" disabled={busy}>
            {busy ? "Saving…" : "Save and carry on"}
          </Button>
        </form>
      )}
      {gift.pauseReason === "terms_changed" && gift.kind === "programme" && <AcceptNewDeed token={token} gift={gift} onChange={onChange} />}
      {gift.pauseReason === "terms_changed" && gift.kind !== "programme" && <AcceptNewTerms token={token} onChange={onChange} />}
      {gift.pauseReason === "below_minimum" && (
        <>
          <p className="text-sm font-semibold text-amber-950">The minimum gift has gone up</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            Raise your monthly amount to at least {formatMoney(gift.minimumAmount, gift.currency, { decimals: 0 })} below, and your gift
            will carry on.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Monthly zakah only: the agency (wakalah) wording changed after the payer
 * set it up, so it's paused until they accept the current one. Shows the
 * exact text and sends its version; the server accepts only the current one.
 */
function AcceptNewTerms({ token, onChange }: { token: string; onChange: (gift: ManagedGift) => void }) {
  const [terms, setTerms] = useState<{ version: string; text: string } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<{ wakalah: { version: string; text: string } }>("/zakah-payments/terms")
      .then((t) => setTerms(t.wakalah))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load the terms."));
  }, []);

  async function accept() {
    if (!terms) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await apiFetchJson<ManagedGift>(`/giving/manage/${token}/terms`, { method: "POST", body: JSON.stringify({ version: terms.version }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold text-amber-950">The terms for paying zakah through Birr have changed</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-900">Please read the new wording. Your monthly zakah carries on once you accept it.</p>
      {error && (
        <Alert tone="danger" title="That didn't work" className="mt-3">
          {error}
        </Alert>
      )}
      {terms && (
        <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>{terms.text}</span>
        </label>
      )}
      <Button type="button" className="mt-4" disabled={!terms || !accepted || busy} onClick={accept}>
        {busy ? "Saving…" : "Accept and carry on"}
      </Button>
    </div>
  );
}

/**
 * Monthly clinic endowment gifts (2026-11-17): a new version of the waqf's
 * deed was approved after the giver set it up, so it's paused until they
 * accept it. Shows the full text and sends its id and hash; the server
 * accepts only the current approved version.
 */
function AcceptNewDeed({ token, gift, onChange }: { token: string; gift: ManagedGift; onChange: (gift: ManagedGift) => void }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deed = gift.newDeed;

  async function accept() {
    if (!deed) return;
    setBusy(true);
    setError(null);
    try {
      onChange(
        await apiFetchJson<ManagedGift>(`/giving/manage/${token}/deed`, { method: "POST", body: JSON.stringify({ deedId: deed.id, textHash: deed.textHash }) }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold text-amber-950">The waqf&apos;s deed has a new version</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-900">Please read it. Your monthly endowment gift carries on once you accept it.</p>
      {error && (
        <Alert tone="danger" title="That didn't work" className="mt-3">
          {error}
        </Alert>
      )}
      {deed && (
        <>
          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-amber-200 bg-white p-3 font-sans text-xs leading-relaxed text-slate-700">
            {deed.text}
          </pre>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>I give each monthly gift as a waqf under version {deed.version} of this deed.</span>
          </label>
        </>
      )}
      <Button type="button" className="mt-4" disabled={!deed || !accepted || busy} onClick={accept}>
        {busy ? "Saving…" : "Accept and carry on"}
      </Button>
    </div>
  );
}

function ChangeAmount({ token, gift, onChange }: { token: string; gift: ManagedGift; onChange: (gift: ManagedGift) => void }) {
  const [amount, setAmount] = useState(String(Number(gift.amount)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const unchanged = Number(amount) === Number(gift.amount);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onChange(await apiFetchJson<ManagedGift>(`/giving/manage/${token}/amount`, { method: "POST", body: JSON.stringify({ amount }) }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Change the amount">
      <form onSubmit={save}>
        {error && (
          <Alert tone="danger" title="Couldn't change the amount" className="mb-3">
            {error}
          </Alert>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <MoneyInput id="monthly-amount" aria-label="Monthly amount" currency={gift.currency} required value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">
              From the next charge. At least {formatMoney(gift.minimumAmount, gift.currency, { decimals: 0 })}.
            </p>
          </div>
          <Button type="submit" variant="secondary" disabled={busy || unchanged} className="shrink-0">
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
        {saved && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary-700">
            <IconCheckCircle className="h-3.5 w-3.5" /> Saved
          </p>
        )}
      </form>
    </Section>
  );
}

function History({ gift }: { gift: ManagedGift }) {
  const label = { confirmed: "Paid", failed: "Didn't go through", pending: "Processing" } as const;
  const tone = { confirmed: "text-primary-700", failed: "text-rose-700", pending: "text-slate-500" } as const;
  return (
    <Section title="Payments">
      <ul className="divide-y divide-slate-100">
        {gift.charges.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <span className="text-slate-700">{formatPeriod(c.period, c.date)}</span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums text-slate-900">{formatMoney(c.amount, gift.currency, { decimals: 0 })}</span>
              <span className={`w-28 text-right text-xs font-medium ${tone[c.status]}`}>{label[c.status]}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CancelGift({ token, gift, onChange }: { token: string; gift: ManagedGift; onChange: (gift: ManagedGift) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onChange(await apiFetchJson<ManagedGift>(`/giving/manage/${token}/cancel`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="px-1">
      {error && (
        <Alert tone="danger" title="Couldn't cancel" className="mb-3">
          {error}
        </Alert>
      )}
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-rose-700 hover:text-rose-800">
          Cancel monthly gift
        </button>
      ) : (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
          <p className="text-sm font-semibold text-rose-950">Cancel your monthly {gift.kind === "zakah" ? "zakah" : "gift"}?</p>
          <p className="mt-1 text-sm text-rose-900">No further payments will be taken. Payments already made stay as they are.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" variant="danger" disabled={busy} onClick={cancel}>
              {busy ? "Cancelling…" : "Yes, cancel it"}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
