"use client";

// Account & security — the one standing settings surface the Founder
// Portal has (WhatsApp verification lives inside onboarding, not here,
// since it's a one-time prerequisite rather than an ongoing setting).
// MFA here is opt-in, unlike birr_staff's mandatory setup
// (SessionAuthGuard forces every staff member through enrollment) —
// Founders self-service sign up through this "lightweight" portal
// (CLAUDE.md), and forcing enrollment at signup would add real
// onboarding friction with no equivalent internal-mandate
// justification. Nothing here blocks any other route if MFA stays off.
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { useFounderSession } from "../../../lib/founder-session";
import type { MfaEnrollmentConfirm, MfaEnrollmentStart } from "../../../lib/types";
import { Alert, Badge, Button, Card, Input, Skeleton } from "@birr/ui";

type EnrollStep = "idle" | "starting" | "scan" | "backup-codes";

export default function AccountPage() {
  const { user, loading } = useFounderSession();

  if (loading || !user) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Account & security</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        {user.fullName} · {user.email}
      </p>

      <div className="mt-6">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Two-factor authentication</p>
              <p className="mt-1 text-sm text-slate-500">
                {user.mfaEnabled
                  ? "Enabled — signing in also asks for a code from your authenticator app."
                  : "Add an extra step at sign-in using an authenticator app (Google Authenticator, 1Password, Authy, or similar)."}
              </p>
            </div>
            <Badge tone={user.mfaEnabled ? "success" : "neutral"}>{user.mfaEnabled ? "Enabled" : "Not enabled"}</Badge>
          </div>
          {user.mfaEnabled ? (
            <p className="mt-3 text-xs text-slate-400">
              Lost your device and your backup codes? Contact Birr — only a platform admin can reset this for you.
            </p>
          ) : (
            <div className="mt-4">
              <EnrollFlow />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function EnrollFlow() {
  const [step, setStep] = useState<EnrollStep>("idle");
  const [enrollment, setEnrollment] = useState<MfaEnrollmentStart | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    setError(null);
    setStep("starting");
    try {
      const data = await apiFetchJson<MfaEnrollmentStart>("/founders/me/mfa/enroll", { method: "POST" });
      setEnrollment(data);
      setStep("scan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStep("idle");
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetchJson<MfaEnrollmentConfirm>("/founders/me/mfa/enroll/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setBackupCodes(result.backupCodes);
      setStep("backup-codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "idle") {
    return (
      <>
        {error && (
          <Alert tone="danger" title="Couldn't start two-factor setup" className="mb-3">
            {error}
          </Alert>
        )}
        <Button variant="primary" onClick={handleStart}>
          Enable two-factor authentication
        </Button>
      </>
    );
  }

  if (step === "starting") {
    return <p className="text-sm text-slate-400">Setting up…</p>;
  }

  if (step === "scan" && enrollment) {
    return (
      <div>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a base64 data URL, not an optimizable remote/static asset */}
          <img
            src={enrollment.qrCodeDataUrl}
            alt="Scan this QR code with your authenticator app"
            className="h-40 w-40 rounded-lg border border-slate-200"
          />
        </div>
        <p className="mt-3 text-center text-xs text-slate-400">Can&apos;t scan it? Enter this code manually:</p>
        <p className="mt-1 break-all rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-sm text-slate-700">
          {enrollment.secretForManualEntry}
        </p>
        <form onSubmit={handleConfirm} className="mt-4 space-y-3">
          {error && (
            <Alert tone="danger" title="Couldn't confirm">
              {error}
            </Alert>
          )}
          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-slate-700">
              Enter the 6-digit code from your app
            </label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" disabled={submitting} className="w-full">
            {submitting ? "Confirming…" : "Confirm and enable"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <Alert tone="warning" title="Save your backup codes — shown only once">
        If you lose access to your authenticator app, any one of these codes signs you in instead. Save them
        somewhere safe — only a platform admin can reset this if you lose both.
      </Alert>
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-4 font-mono text-sm text-slate-700">
        {backupCodes.map((backupCode) => (
          <span key={backupCode}>{backupCode}</span>
        ))}
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => {
          // Full reload, not local state — forces FounderSessionProvider
          // to remount and re-fetch GET /founders/me, which now reports
          // mfaEnabled: true.
          window.location.reload();
        }}
      >
        I&apos;ve saved these — done
      </Button>
    </div>
  );
}
