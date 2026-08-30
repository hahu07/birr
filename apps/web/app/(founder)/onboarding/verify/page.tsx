"use client";

// Step 1 — email + WhatsApp verification. Branches on which half is
// still pending: email is verified out-of-band (a link clicked in an
// inbox, see app/verified/page.tsx), so this page shows a "check your
// email" state until that's done, then the in-app WhatsApp phone/code
// form. Never hardcodes the next route on success: app-shell.tsx alone
// decides "what's next" off a fresh onboarding-status read, so a
// step-reordering later needs one change, not N.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { useOnboardingStatus } from "../../../../lib/onboarding";
import { Alert, Button, Card, Input, Skeleton } from "@birr/ui";

export default function VerifyPage() {
  const { status, loading } = useOnboardingStatus(true);

  if (loading || !status) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (!status.steps.emailVerified.complete) {
    return <CheckYourEmail />;
  }

  return <VerifyWhatsAppForm />;
}

// Sign-up always logs the founder in immediately, whether or not the
// original verification email actually made it out (see
// FoundersService.signUp()'s own comment) — "sign up again" used to be
// offered here as the fallback, but that just fails with "an account
// already exists" since the account is real. Resending is the actual
// fix for a Resend outage, spam filter, or an expired link.
function CheckYourEmail() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    setStatus("sending");
    setError(null);
    try {
      await apiFetchJson("/founders/resend-verification-email", { method: "POST" });
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Check your email</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        We sent a verification link to your inbox. Click it to continue — this page will move on automatically
        once you're verified.
      </p>

      {status === "error" && (
        <Alert tone="danger" title="Couldn't resend" className="mt-6">
          {error}
        </Alert>
      )}
      {status === "sent" && (
        <Alert tone="success" title="Email sent" className="mt-6">
          Check your inbox for a new verification link.
        </Alert>
      )}

      <Card className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">Didn&apos;t get it? Check spam, or send a new link.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={handleResend}
            disabled={status === "sending"}
            className="shrink-0"
          >
            {status === "sending" ? "Sending…" : "Resend email"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function VerifyWhatsAppForm() {
  const [phase, setPhase] = useState<"phone" | "code">("phone");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/whatsapp/request-otp", {
        method: "POST",
        body: JSON.stringify({ whatsappNumber }),
      });
      setPhase("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/whatsapp/verify-otp", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      // Success — app-shell.tsx re-reads onboarding status and routes
      // onward on its own. A full reload is the simplest way to force
      // that re-fetch immediately, matching /verified's own precedent.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Verify your WhatsApp number</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        We&apos;ve added this as a required verification step alongside email, to keep every Founder account
        secure.
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't verify" className="mt-6">
          {error}
        </Alert>
      )}

      {phase === "phone" ? (
        <form onSubmit={handleRequestOtp} className="mt-6">
          <Card>
            <label htmlFor="whatsappNumber" className="mb-1.5 block text-sm font-medium text-slate-700">
              WhatsApp number
            </label>
            <Input
              id="whatsappNumber"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="+15551234567"
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">International format, including the + and country code.</p>
          </Card>
          <div className="mt-6 flex justify-end">
            <Button type="submit" variant="primary" disabled={submitting || whatsappNumber.trim().length === 0}>
              {submitting ? "Sending…" : "Send code"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="mt-6">
          <Card>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-slate-700">
              6-digit code
            </label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              inputMode="numeric"
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Sent to {whatsappNumber} via WhatsApp. Expires in 10 minutes.
            </p>
          </Card>
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setPhase("phone");
                setCode("");
                setError(null);
              }}
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              ← Use a different number
            </button>
            <Button type="submit" variant="primary" disabled={submitting || code.trim().length === 0}>
              {submitting ? "Verifying…" : "Verify"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
