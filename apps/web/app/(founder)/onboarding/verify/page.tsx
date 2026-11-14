"use client";

// Step 1 — email + WhatsApp verification. Branches on which half is
// still pending: email is verified out-of-band (a link clicked in an
// inbox, see app/verified/page.tsx), so this page shows a "check your
// email" state until that's done, then the in-app WhatsApp phone/code
// form.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { useFounderSession } from "../../../../lib/founder-session";
import { ROUTE_FOR_STEP, useOnboardingStatus } from "../../../../lib/onboarding";
import { Alert, Button, Card, IconCheckCircle, IconInbox, IconMessageCircle, IconShieldCheck, Input, Skeleton } from "@birr/ui";

// The backend allows 5 sends per 10 minutes for both the email and the
// WhatsApp code; a minute between resends keeps a founder well inside
// that without them having to guess why a sixth attempt was refused.
const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;

export default function VerifyPage() {
  const { status, loading } = useOnboardingStatus(true);

  if (loading || !status) {
    return <Skeleton className="h-72 w-full" />;
  }

  const emailVerified = status.steps.emailVerified.complete;
  return (
    <div>
      <VerificationChecklist emailVerified={emailVerified} />
      <div className="mt-8">{emailVerified ? <VerifyWhatsAppForm /> : <CheckYourEmail />}</div>
    </div>
  );
}

/** Seconds left before another send is allowed, and a function to start the wait. */
function useCooldown(): [number, () => void] {
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);
  return [secondsLeft, () => setSecondsLeft(RESEND_COOLDOWN_SECONDS)];
}

// The two halves of step 1, so a founder can see where they are within
// it — the wizard's own progress bar only shows "Verify" as one step.
function VerificationChecklist({ emailVerified }: { emailVerified: boolean }) {
  return (
    <ol className="grid grid-cols-2 gap-3" aria-label="Verification progress">
      <ChecklistItem icon={<IconInbox className="h-4 w-4" />} label="Email" state={emailVerified ? "done" : "current"} />
      <ChecklistItem
        icon={<IconMessageCircle className="h-4 w-4" />}
        label="WhatsApp"
        state={emailVerified ? "current" : "upcoming"}
      />
    </ol>
  );
}

function ChecklistItem({ icon, label, state }: { icon: ReactNode; label: string; state: "done" | "current" | "upcoming" }) {
  const box = {
    done: "border-primary-200 bg-primary-50",
    current: "border-primary-600 bg-white ring-4 ring-primary-50",
    upcoming: "border-slate-200 bg-white",
  }[state];
  const badge = {
    done: "bg-primary-600 text-white",
    current: "bg-primary-50 text-primary-700",
    upcoming: "bg-slate-100 text-slate-400",
  }[state];
  const caption = { done: "Verified", current: "In progress", upcoming: "Next" }[state];
  return (
    <li className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${box}`} aria-current={state === "current" ? "step" : undefined}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${badge}`}>
        {state === "done" ? <IconCheckCircle className="h-4 w-4" /> : icon}
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-sm font-medium ${state === "upcoming" ? "text-slate-400" : "text-slate-900"}`}>{label}</span>
        <span className={`block text-xs ${state === "done" ? "text-primary-700" : "text-slate-500"}`}>{caption}</span>
      </span>
    </li>
  );
}

function StepHeading({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">{icon}</span>
      <h1 className="font-display mt-5 text-3xl font-medium tracking-tight text-slate-900">{title}</h1>
      <div className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">{children}</div>
    </div>
  );
}

function SecurityNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 flex items-start justify-center gap-2 text-center text-xs leading-relaxed text-slate-500">
      <IconShieldCheck className="mt-px h-4 w-4 shrink-0 text-primary-700" />
      <span>{children}</span>
    </p>
  );
}

// Sign-up always logs the founder in immediately, whether or not the
// original verification email actually made it out (see
// FoundersService.signUp()'s own comment) — "sign up again" used to be
// offered here as the fallback, but that just fails with "an account
// already exists" since the account is real. Resending is the actual
// fix for a Resend outage, spam filter, or an expired link.
function CheckYourEmail() {
  const { user } = useFounderSession();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  async function handleResend() {
    setStatus("sending");
    setError(null);
    try {
      await apiFetchJson("/founders/resend-verification-email", { method: "POST" });
      setStatus("sent");
      startCooldown();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div>
      <StepHeading icon={<IconInbox className="h-7 w-7" />} title="Check your email">
        We sent a verification link to{" "}
        {user?.email ? <span className="font-medium text-slate-900">{user.email}</span> : "your inbox"}. This page moves on by
        itself once you&apos;ve clicked it.
      </StepHeading>

      {status === "error" && (
        <Alert tone="danger" title="Couldn't resend" className="mt-8">
          {error}
        </Alert>
      )}
      {status === "sent" && (
        <Alert tone="success" title="New link sent" className="mt-8">
          Check your inbox. Only the newest link works.
        </Alert>
      )}

      <Card className="mt-8">
        <ol className="space-y-3 text-sm text-slate-600">
          {["Open the email from Birr.", "Click Verify email.", "Come back here — you'll move on to WhatsApp."].map((line, i) => (
            <li key={line} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">Nothing yet? Check your spam folder.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={handleResend}
            disabled={status === "sending" || cooldown > 0}
            className="shrink-0"
          >
            {status === "sending" ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Accepts what people actually type — "0801 234 5678", "234801…",
 * "+234 801-234-5678" — and returns the +E.164 form the backend
 * requires. An 11-digit number starting with 0 is read as Nigerian,
 * since that's how numbers are written locally; anything else is left
 * for the backend's own E.164 check to accept or explain.
 */
function toE164(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

/** "+2348012345678" -> "+234 801 234 5678"; other countries are shown as entered. */
function formatPhone(e164: string): string {
  const ng = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return ng ? `+234 ${ng[1]} ${ng[2]} ${ng[3]}` : e164;
}

function VerifyWhatsAppForm() {
  const [phase, setPhase] = useState<"phone" | "code">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  async function requestOtp(whatsappNumber: string) {
    await apiFetchJson("/founders/whatsapp/request-otp", {
      method: "POST",
      body: JSON.stringify({ whatsappNumber }),
    });
    setSentTo(whatsappNumber);
    startCooldown();
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestOtp(toE164(phoneInput));
      setPhase("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendCode() {
    setError(null);
    setResent(false);
    try {
      await requestOtp(sentTo);
      setCode("");
      setResent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function verify(value: string) {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/whatsapp/verify-otp", {
        method: "POST",
        body: JSON.stringify({ code: value }),
      });
      // Full navigation straight to step 2's own route, not a reload of
      // this one — app-shell's onboarding gate deliberately leaves an
      // "earlier completed step" alone rather than bouncing it forward
      // (so looking back at a finished step doesn't fight the URL),
      // which means a same-URL reload right after JUST finishing this
      // step would otherwise strand the founder here instead of
      // advancing them (same fix as founder-foundation/page.tsx's own
      // post-establish navigation, for the same reason).
      window.location.href = ROUTE_FOR_STEP[2];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const normalized = toE164(phoneInput);
  const showNormalized = phoneInput.trim().length > 0 && normalized !== phoneInput.replace(/\s/g, "");

  return (
    <div>
      <StepHeading icon={<IconMessageCircle className="h-7 w-7" />} title={phase === "phone" ? "Add your WhatsApp number" : "Enter your code"}>
        {phase === "phone" ? (
          "We'll send a 6-digit code to confirm it's yours. It's how Birr checks it's really you, and where you can choose to get updates about your Foundation."
        ) : (
          <>
            We sent a 6-digit code by WhatsApp to <span className="whitespace-nowrap font-medium text-slate-900">{formatPhone(sentTo)}</span>. It expires in
            10 minutes.
          </>
        )}
      </StepHeading>

      {error && (
        <Alert tone="danger" title={phase === "phone" ? "Couldn't send the code" : "Couldn't verify"} className="mt-8">
          {error}
        </Alert>
      )}
      {resent && !error && (
        <Alert tone="success" title="New code sent" className="mt-8">
          Use the newest code — earlier ones no longer work.
        </Alert>
      )}

      {phase === "phone" ? (
        <form onSubmit={handleRequestOtp}>
          <Card className="mt-8">
            <label htmlFor="whatsappNumber" className="mb-1.5 block text-sm font-medium text-slate-700">
              WhatsApp number
            </label>
            <Input
              id="whatsappNumber"
              type="tel"
              autoComplete="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="0801 234 5678"
              aria-describedby="whatsappNumber-hint"
              required
            />
            <p id="whatsappNumber-hint" className="mt-1.5 text-xs text-slate-500">
              {showNormalized ? (
                <>
                  We&apos;ll send it to <span className="font-medium text-slate-700">{formatPhone(normalized)}</span>
                </>
              ) : (
                "A Nigerian number, or any number with its country code (+44…, +1…)."
              )}
            </p>
            <Button type="submit" variant="primary" className="mt-5 w-full" disabled={submitting || phoneInput.trim().length === 0}>
              {submitting ? "Sending code…" : "Send code"}
            </Button>
          </Card>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <Card className="mt-8">
            <OtpInput
              value={code}
              onChange={(next) => {
                setCode(next);
                if (next.length === CODE_LENGTH && !submitting) void verify(next);
              }}
              disabled={submitting}
              invalid={Boolean(error)}
            />
            <Button type="submit" variant="primary" className="mt-6 w-full" disabled={submitting || code.length !== CODE_LENGTH}>
              {submitting ? "Verifying…" : "Verify"}
            </Button>
            <div className="mt-5 flex flex-col items-center gap-2 border-t border-slate-100 pt-5 text-sm sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  setPhase("phone");
                  setCode("");
                  setError(null);
                  setResent(false);
                }}
                className="font-medium text-slate-600 hover:text-slate-900"
              >
                Use a different number
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={cooldown > 0 || submitting}
                className="font-medium text-primary-700 hover:text-primary-800 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </Card>
        </form>
      )}

      <SecurityNote>Birr will never call or message you to ask for this code. Don&apos;t share it with anyone.</SecurityNote>
    </div>
  );
}

/**
 * Six single-digit boxes that behave as one field: typing moves to the
 * next box, Backspace on an empty box moves back, and pasting a whole
 * code (from WhatsApp, or the phone's own one-time-code suggestion)
 * fills every box at once.
 */
function OtpInput({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  function setFrom(index: number, typed: string) {
    const digits = typed.replace(/\D/g, "");
    if (!digits) return;
    const next = (value.slice(0, index) + digits).slice(0, CODE_LENGTH);
    onChange(next);
    inputs.current[Math.min(next.length, CODE_LENGTH - 1)]?.focus();
  }

  return (
    <fieldset>
      <legend className="mb-3 block w-full text-center text-sm font-medium text-slate-700">6-digit code</legend>
      <div className="flex justify-center gap-2 sm:gap-3">
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1}`}
            maxLength={i === 0 ? CODE_LENGTH : 1}
            value={value[i] ?? ""}
            disabled={disabled}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setFrom(i, e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              setFrom(0, e.clipboardData.getData("text"));
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                e.preventDefault();
                if (value[i]) onChange(value.slice(0, i));
                else if (i > 0) {
                  onChange(value.slice(0, i - 1));
                  inputs.current[i - 1]?.focus();
                }
              } else if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
              else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) inputs.current[i + 1]?.focus();
            }}
            className={`h-12 w-11 rounded-lg border bg-white text-center text-xl font-semibold text-slate-900 tabular-nums shadow-sm transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 sm:h-14 sm:w-12 ${
              invalid ? "border-red-300 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-primary-500 focus:ring-primary-100"
            }`}
          />
        ))}
      </div>
    </fieldset>
  );
}
