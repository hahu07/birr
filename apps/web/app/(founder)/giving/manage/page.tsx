"use client";

// "Send me my links": a monthly giver who has lost their private link gets
// fresh ones (POST /giving/manage-links), by email or, for a WhatsApp
// number confirmed with a code, by WhatsApp (2026-11-16). The answer is the
// same whether or not they give monthly, so it reveals nothing.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { Alert, Button, IconCheckCircle, Input } from "@birr/ui";
import { type ConfirmedWhatsApp, WhatsAppConfirmField } from "../../_components/GiverContactFields";

export default function RequestManageLinksPage() {
  const [via, setVia] = useState<"email" | "whatsapp">("email");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState<ConfirmedWhatsApp | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = via === "email" ? { email } : { whatsapp: whatsapp!.number, whatsappProof: whatsapp!.proof };
      await apiFetchJson("/giving/manage-links", { method: "POST", body: JSON.stringify(body) });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-primary-700 via-primary-500 to-accent-500" />
        <div className="p-6 sm:p-8">
          <h1 className="font-display text-2xl font-medium tracking-tight text-slate-900">Manage your monthly giving</h1>
          {sent ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-primary-50/70 p-4 text-sm text-slate-700">
              <IconCheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" />
              <p>
                {via === "email" ? (
                  <>
                    If <strong>{email}</strong> gives monthly through Birr, we&apos;ve emailed a private link for each gift.
                  </>
                ) : (
                  <>If that number gives monthly through Birr, we&apos;ve sent a private link for each gift by WhatsApp.</>
                )}{" "}
                Earlier links no longer work.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-2">
              <p className="text-sm leading-relaxed text-slate-600">
                Tell us the email or WhatsApp number you give with, and we&apos;ll send you a private link to change the amount, update your card or
                cancel.
              </p>
              {error && (
                <Alert tone="danger" title="Couldn't send your links" className="mt-4">
                  {error}
                </Alert>
              )}
              <div role="radiogroup" aria-label="Send my links by" className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                {(["email", "whatsapp"] as const).map((v) => (
                  <label
                    key={v}
                    className={`flex cursor-pointer items-center justify-center rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                      via === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <input type="radio" name="manage-via" value={v} className="sr-only" checked={via === v} onChange={() => setVia(v)} />
                    {v === "email" ? "Email" : "WhatsApp"}
                  </label>
                ))}
              </div>
              {via === "email" ? (
                <>
                  <label htmlFor="manage-email" className="mb-1.5 mt-4 block text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <Input id="manage-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </>
              ) : (
                <div className="mt-4">
                  <WhatsAppConfirmField idPrefix="manage" confirmed={whatsapp} onConfirmed={setWhatsapp} />
                </div>
              )}
              <Button type="submit" className="mt-4 w-full" disabled={busy || (via === "whatsapp" && !whatsapp)}>
                {busy ? "Sending…" : via === "email" ? "Email me my links" : "Send my links by WhatsApp"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
