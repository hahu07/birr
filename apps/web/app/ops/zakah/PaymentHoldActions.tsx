"use client";

// AML holds on a zakah payment, staff only. A Compliance officer or a
// Mutawalli Officer may hold a confirmed payment (it only freezes money);
// only Compliance may release one. The payer never sees any of this —
// that would be tipping off.
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { useStaffSession } from "../../../lib/staff-session";
import type { ZakahPaymentRow } from "../../../lib/ops-types";
import { Button, Input } from "@birr/ui";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function PaymentHoldActions({ payment, onChange }: { payment: ZakahPaymentRow; onChange: () => void }) {
  const { can } = useStaffSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(path: string, body?: object) {
    setError(null);
    setBusy(true);
    try {
      await apiFetchJson(path, { method: "POST", ...(body && { body: JSON.stringify(body) }) });
      setOpen(false);
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (payment.heldAt) {
    if (!can("zakah.payment_release")) return null;
    return (
      <div>
        <Button
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Release this hold? Its zakah can then be distributed.")) void post(`/zakah-payments/${payment.id}/release`);
          }}
        >
          Release hold
        </Button>
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  if (payment.status !== "confirmed" || !can("zakah.payment_hold")) return null;
  if (!open) {
    return (
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
        Hold
      </Button>
    );
  }
  return (
    <form
      className="w-72 space-y-2 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void post(`/zakah-payments/${payment.id}/hold`, { reason });
      }}
    >
      <p className="text-xs text-slate-500">Freezes this zakah so it can&apos;t be distributed until Compliance releases it. The payer isn&apos;t told.</p>
      <div>
        <label htmlFor={`hold-reason-${payment.id}`} className="mb-1 block text-xs font-medium text-slate-700">Why</label>
        <Input id={`hold-reason-${payment.id}`} required minLength={10} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="px-2.5 py-1.5 text-xs" disabled={busy}>
          {busy ? "Holding…" : "Hold payment"}
        </Button>
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
