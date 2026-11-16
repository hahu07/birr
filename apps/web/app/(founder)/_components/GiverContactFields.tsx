"use client";

// How a giver without an account hears from Birr: by email, by WhatsApp, or
// both (owner's decision, 2026-11-16). A WhatsApp number is only used once
// confirmed with a 6-digit code sent to it; confirming hands back a proof
// the giving routes check, so an unconfirmed number never reaches them.
import { useState, type ReactNode } from "react";
import { Button, IconCheckCircle, Input } from "@birr/ui";
import { apiFetchJson } from "../../../lib/api";
import { CODE_LENGTH, OtpInput } from "../onboarding/verify/OtpInput";

export interface ConfirmedWhatsApp {
  /** E.164, as the backend confirmed it. */
  number: string;
  proof: string;
}

export interface GiverContactValue {
  via: "email" | "whatsapp" | "both";
  email: string;
  whatsapp: ConfirmedWhatsApp | null;
}

export const EMPTY_CONTACT: GiverContactValue = { via: "email", email: "", whatsapp: null };

const usesEmail = (v: GiverContactValue) => v.via !== "whatsapp";
const usesWhatsApp = (v: GiverContactValue) => v.via !== "email";

/**
 * Whether the form can be sent: a chosen WhatsApp number must be confirmed,
 * and when contact is required (monthly giving) the chosen ways must be filled.
 */
export function contactReady(v: GiverContactValue, required: boolean): boolean {
  if (usesWhatsApp(v) && !v.whatsapp) return false;
  if (required && usesEmail(v) && !v.email.trim()) return false;
  return true;
}

/** The fields to send, under the giving route's own names. */
export function contactPayload(v: GiverContactValue, names: { email: string; whatsapp: string }) {
  return {
    ...(usesEmail(v) && v.email.trim() && { [names.email]: v.email.trim() }),
    ...(usesWhatsApp(v) && v.whatsapp && { [names.whatsapp]: v.whatsapp.number, whatsappProof: v.whatsapp.proof }),
  };
}

/** "+2348031234567" → "+234 803 ••• 4567". */
function displayNumber(e164: string): string {
  return e164.startsWith("+234") && e164.length === 14 ? `+234 ${e164.slice(4, 7)} ••• ${e164.slice(-4)}` : `${e164.slice(0, -4).replace(/\d/g, "•")}${e164.slice(-4)}`;
}

const CHOICES: { via: GiverContactValue["via"]; label: string }[] = [
  { via: "email", label: "Email" },
  { via: "whatsapp", label: "WhatsApp" },
  { via: "both", label: "Both" },
];

export function GiverContactFields({
  idPrefix,
  value,
  onChange,
  required,
  emailLabel,
  emailHint,
  legend = "Send my receipts to",
}: {
  idPrefix: string;
  value: GiverContactValue;
  onChange: (value: GiverContactValue) => void;
  /** Monthly giving needs a way to reach the giver; a one-off gift doesn't. */
  required: boolean;
  /** The email field's label, so each form keeps its own wording. */
  emailLabel: ReactNode;
  emailHint?: ReactNode;
  legend?: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 block text-sm font-medium text-slate-700">{legend}</legend>
      <div role="radiogroup" aria-label={legend} className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {CHOICES.map((c) => (
          <label
            key={c.via}
            className={`flex cursor-pointer items-center justify-center rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
              value.via === c.via ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <input type="radio" name={`${idPrefix}-via`} value={c.via} className="sr-only" checked={value.via === c.via} onChange={() => onChange({ ...value, via: c.via })} />
            {c.label}
          </label>
        ))}
      </div>

      {usesEmail(value) && (
        <div>
          <label htmlFor={`${idPrefix}-email`} className="mb-1.5 block text-sm font-medium text-slate-700">
            {emailLabel}
          </label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="email"
            required={required && usesEmail(value)}
            value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
          />
          {emailHint && <p className="mt-1 text-xs text-slate-500">{emailHint}</p>}
        </div>
      )}

      {usesWhatsApp(value) && (
        <WhatsAppConfirmField idPrefix={idPrefix} confirmed={value.whatsapp} onConfirmed={(whatsapp) => onChange({ ...value, whatsapp })} />
      )}
    </fieldset>
  );
}

export function WhatsAppConfirmField({
  idPrefix,
  confirmed,
  onConfirmed,
}: {
  idPrefix: string;
  confirmed: ConfirmedWhatsApp | null;
  onConfirmed: (confirmed: ConfirmedWhatsApp | null) => void;
}) {
  const [number, setNumber] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const sent = await apiFetchJson<{ number: string }>("/giving/whatsapp/code", { method: "POST", body: JSON.stringify({ whatsapp: number }) });
      setSentTo(sent.number);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(full: string) {
    if (!sentTo) return;
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetchJson<{ whatsapp: string; proof: string }>("/giving/whatsapp/confirm", {
        method: "POST",
        body: JSON.stringify({ whatsapp: sentTo, code: full }),
      });
      onConfirmed({ number: result.whatsapp, proof: result.proof });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    onConfirmed(null);
    setSentTo(null);
    setCode("");
    setError(null);
  }

  if (confirmed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50/70 px-3.5 py-2.5 text-sm">
        <span className="flex items-center gap-2 font-medium text-primary-900">
          <IconCheckCircle aria-hidden="true" className="h-4 w-4 text-primary-600" />
          WhatsApp {displayNumber(confirmed.number)} confirmed
        </span>
        <button type="button" className="text-xs font-medium text-primary-700 hover:text-primary-900" onClick={startAgain}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!sentTo ? (
        <>
          <label htmlFor={`${idPrefix}-whatsapp`} className="block text-sm font-medium text-slate-700">
            WhatsApp number
          </label>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-whatsapp`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0803 123 4567"
              className="flex-1"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
            <Button type="button" variant="secondary" disabled={busy || number.replace(/\D/g, "").length < 8} onClick={sendCode} className="shrink-0">
              {busy ? "Sending…" : "Send code"}
            </Button>
          </div>
          <p className="text-xs text-slate-500">We&apos;ll send a 6-digit code by WhatsApp to confirm it&apos;s yours.</p>
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 p-3.5">
          <p className="mb-3 text-center text-sm text-slate-600">
            Enter the code we sent by WhatsApp to <span className="font-medium text-slate-900">{displayNumber(sentTo)}</span>.
          </p>
          <OtpInput
            value={code}
            disabled={busy}
            invalid={Boolean(error)}
            onChange={(next) => {
              setCode(next);
              if (next.length === CODE_LENGTH && !busy) void confirm(next);
            }}
          />
          <div className="mt-3 flex justify-center gap-4 text-xs font-medium">
            <button type="button" className="text-primary-700 hover:text-primary-900" disabled={busy} onClick={sendCode}>
              Send again
            </button>
            <button type="button" className="text-slate-500 hover:text-slate-800" disabled={busy} onClick={startAgain}>
              Change number
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
