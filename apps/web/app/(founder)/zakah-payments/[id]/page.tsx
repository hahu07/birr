"use client";

// Where Paystack sends a zakah payer back after checkout. Same polling as
// /vault-contributions/[id]: read the status every couple of seconds, and
// every few reads ask the backend to check with Paystack directly, so a
// payment never looks stuck just because its webhook was slow.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatMoney } from "../../../../lib/format";
import { Alert, Button, Card, IconCheckCircle, IconClock, IconXCircle, Skeleton } from "@birr/ui";

interface ZakahPaymentStatus {
  id: string;
  amount: string;
  feeCover: string;
  currency: string;
  status: "pending" | "confirmed" | "failed";
}

const POLL_INTERVAL_MS = 2000;
const POLL_GIVE_UP_AFTER_MS = 10 * 60 * 1000;
const VERIFY_EVERY_N_POLLS = 5;
const STALL_AFTER_MS = 120_000;

export default function ZakahPaymentStatusPage() {
  const params = useParams<{ id: string }>();
  const [payment, setPayment] = useState<ZakahPaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    const startedAt = Date.now();

    async function poll() {
      try {
        const verified =
          polls % VERIFY_EVERY_N_POLLS === 0
            ? await apiFetchJson<ZakahPaymentStatus>(`/zakah-payments/${params.id}/verify`, { method: "POST" }).catch(() => null)
            : null;
        const data = verified ?? (await apiFetchJson<ZakahPaymentStatus>(`/zakah-payments/${params.id}`));
        polls += 1;
        if (cancelled) return;
        setPayment(data);
        if (data.status === "pending") {
          if (Date.now() - startedAt >= POLL_GIVE_UP_AFTER_MS) {
            setGaveUp(true);
            return;
          }
          if (Date.now() - startedAt > STALL_AFTER_MS) setStalled(true);
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.id]);

  async function checkAgain() {
    setChecking(true);
    try {
      setPayment(await apiFetchJson<ZakahPaymentStatus>(`/zakah-payments/${params.id}/verify`, { method: "POST" }));
    } catch {
      // The page keeps polling on its own; nothing more to show here.
    } finally {
      setChecking(false);
    }
  }

  const reference = payment && <p className="mt-4 text-xs text-slate-400">Reference: {payment.id}</p>;

  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center">
      {error && (
        <Alert tone="danger" title="We couldn't check your payment">
          {error}
        </Alert>
      )}

      {!error && !payment && (
        <Card>
          <Skeleton className="mx-auto h-11 w-11 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-4 w-48" />
        </Card>
      )}

      {!error && payment?.status === "pending" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <IconClock className="h-5 w-5" />
          </span>
          {gaveUp || stalled ? (
            <>
              <p className="mt-4 text-sm font-medium text-slate-900">We haven&apos;t had confirmation yet</p>
              <p className="mt-1 text-sm text-slate-500">
                If you completed payment, your zakah is safe and may still be processing. If you cancelled at checkout, no money
                was taken.
              </p>
              <Button type="button" variant="secondary" className="mt-4" disabled={checking} onClick={checkAgain}>
                {checking ? "Checking…" : "Check again"}
              </Button>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm font-medium text-slate-900">Waiting for your bank to confirm…</p>
              <p className="mt-1 text-sm text-slate-500">This page updates by itself. Bank transfers can take a little longer than cards.</p>
            </>
          )}
          {reference}
        </Card>
      )}

      {!error && payment?.status === "confirmed" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconCheckCircle className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">Your zakah has been received</p>
          <p className="mt-1 text-sm text-slate-500">
            {formatMoney(payment.amount, payment.currency)} — Birr will pass it on, as your agent, only to people eligible to receive
            zakah.
            {Number(payment.feeCover) > 0 && ` Thank you for also covering the ${formatMoney(payment.feeCover, payment.currency)} processing fee.`}
          </p>
          <p className="mt-2 text-xs text-slate-500">If you gave your email, a receipt is on its way. May Allah accept it from you.</p>
          {reference}
          <Link href="/zakah" className="mt-4 inline-block text-sm font-medium text-primary-700 hover:text-primary-800">
            Back to the zakah calculator →
          </Link>
        </Card>
      )}

      {!error && payment?.status === "failed" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
            <IconXCircle className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">The payment didn&apos;t go through</p>
          <p className="mt-1 text-sm text-slate-500">No zakah was taken. You can try again from the calculator.</p>
          {reference}
          <Link href="/zakah" className="mt-4 inline-block text-sm font-medium text-primary-700 hover:text-primary-800">
            Back to the zakah calculator →
          </Link>
        </Card>
      )}
    </div>
  );
}
