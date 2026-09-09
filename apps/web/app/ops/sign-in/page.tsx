"use client";

import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, AuthSplitLayout, Button, IconMark, Input, PasswordInput } from "@birr/ui";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // "mfa" — password already verified, POST /birr-staff/login set the
  // short-lived MFA-pending cookie (see session.ts's own comment) and
  // is now waiting on a code from this step.
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetchJson<{ ok: true; mfaRequired: boolean }>("/birr-staff/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.mfaRequired) {
        setStep("mfa");
        setSubmitting(false);
        return;
      }
      // Full navigation, not router.push — forces StaffSessionProvider
      // to remount and re-fetch GET /birr-staff/me now that the session
      // cookie is set.
      window.location.href = "/ops";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/birr-staff/login/mfa", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      window.location.href = "/ops";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <AuthSplitLayout
      tone="ops"
      eyebrow="Internal · Birr Staff Only"
      headline="Ops Console"
      subcopy="Case management, approval queues, and governance oversight for Birr's own trustee staff."
    >
      <div className="mb-8 flex items-center gap-2.5 lg:hidden">
        <IconMark className="h-9 w-9" />
        <span className="text-lg font-semibold tracking-tight text-slate-900">Birr Ops Console</span>
      </div>

      {step === "password" ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-2 text-sm text-slate-500">Enter your Birr staff email and password.</p>

          <form onSubmit={handlePasswordSubmit} className="mt-8 space-y-4">
            {error && (
              <Alert tone="danger" title="Couldn't sign in">
                {error}
              </Alert>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button type="submit" variant="primary" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Two-factor verification</h1>
          <p className="mt-2 text-sm text-slate-500">
            {useBackupCode
              ? "Enter one of your saved backup codes."
              : "Enter the 6-digit code from your authenticator app."}
          </p>

          <form onSubmit={handleMfaSubmit} className="mt-8 space-y-4">
            {error && (
              <Alert tone="danger" title="Couldn't verify">
                {error}
              </Alert>
            )}

            <div>
              <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-slate-700">
                {useBackupCode ? "Backup code" : "Authentication code"}
              </label>
              <Input
                id="code"
                inputMode={useBackupCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            <Button type="submit" variant="primary" disabled={submitting} className="w-full">
              {submitting ? "Verifying…" : "Verify"}
            </Button>

            <button
              type="button"
              className="w-full text-center text-xs font-medium text-primary-700 hover:underline"
              onClick={() => {
                setUseBackupCode((v) => !v);
                setCode("");
                setError(null);
              }}
            >
              {useBackupCode ? "Use your authenticator app instead" : "Use a backup code instead"}
            </button>
          </form>
        </>
      )}
    </AuthSplitLayout>
  );
}
