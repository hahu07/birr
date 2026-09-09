"use client";

// Forced enrollment screen — AppShell redirects any signed-in staff
// member with mfaEnabled: false here (see that component's own comment)
// and SessionAuthGuard backs that up server-side by rejecting every
// other route until enrollment is confirmed. MFA is mandatory here, not
// opt-in — see BirrStaffService.login's own comment.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import type { MfaEnrollmentConfirm, MfaEnrollmentStart } from "../../../lib/ops-types";
import { Alert, Button, Card, IconMark, Input } from "@birr/ui";

type Step = "loading" | "scan" | "backup-codes" | "error";

export default function MfaSetupPage() {
  const [step, setStep] = useState<Step>("loading");
  const [enrollment, setEnrollment] = useState<MfaEnrollmentStart | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    apiFetchJson<MfaEnrollmentStart>("/birr-staff/me/mfa/enroll", { method: "POST" })
      .then((data) => {
        setEnrollment(data);
        setStep("scan");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setStep("error");
      });
  }, []);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetchJson<MfaEnrollmentConfirm>("/birr-staff/me/mfa/enroll/confirm", {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <IconMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Birr Ops Console</span>
        </div>

        <Card>
          {step === "loading" && <p className="py-8 text-center text-sm text-slate-400">Setting up…</p>}

          {step === "error" && (
            <Alert tone="danger" title="Couldn't start two-factor setup">
              {error}
            </Alert>
          )}

          {step === "scan" && enrollment && (
            <>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                Set up two-factor authentication
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Two-factor authentication is required for every Birr staff account. Scan this code with an
                authenticator app (Google Authenticator, 1Password, Authy, or similar).
              </p>

              <div className="mt-6 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- a base64 data URL, not an optimizable remote/static asset */}
                <img
                  src={enrollment.qrCodeDataUrl}
                  alt="Scan this QR code with your authenticator app"
                  className="h-48 w-48 rounded-lg border border-slate-200"
                />
              </div>

              <p className="mt-4 text-center text-xs text-slate-400">
                Can't scan it? Enter this code manually:
              </p>
              <p className="mt-1 break-all rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-sm text-slate-700">
                {enrollment.secretForManualEntry}
              </p>

              <form onSubmit={handleConfirm} className="mt-6 space-y-4">
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
            </>
          )}

          {step === "backup-codes" && (
            <>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Save your backup codes</h1>
              <Alert tone="warning" title="These are shown only once" className="mt-3">
                If you lose access to your authenticator app, any one of these codes signs you in instead. Save
                them somewhere safe — they won't be shown again, and only a platform administrator can reset your
                two-factor setup if you lose both.
              </Alert>

              <div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-4 font-mono text-sm text-slate-700">
                {backupCodes.map((backupCode) => (
                  <span key={backupCode}>{backupCode}</span>
                ))}
              </div>

              <Button
                variant="primary"
                className="mt-6 w-full"
                onClick={() => {
                  // Full navigation, not router.push — forces
                  // StaffSessionProvider to remount and re-fetch
                  // GET /birr-staff/me, which now reports mfaEnabled: true.
                  window.location.href = "/ops";
                }}
              >
                I've saved these — continue to Ops Console
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
