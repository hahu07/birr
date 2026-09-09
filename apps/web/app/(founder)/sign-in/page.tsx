"use client";

// Real username/password login — POST /founders/login sets the httpOnly
// session cookie (see lib/api.ts, apps/backend/src/common/auth/session.ts).
// MFA is opt-in for Founders (unlike birr_staff's mandatory setup) — see
// (founder)/account/page.tsx's own comment on why. mfaRequired here just
// means "this specific account already opted in," never "every account
// must."
import Link from "next/link";
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, AuthSplitLayout, Button, IconMark, Input, PasswordInput } from "@birr/ui";

export default function SignInPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetchJson<{ ok: true; mfaRequired: boolean }>("/founders/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (result.mfaRequired) {
        setStep("mfa");
        setSubmitting(false);
        return;
      }
      window.location.href = "/";
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
      await apiFetchJson("/founders/login/mfa", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const canSubmitPassword = username.trim().length > 0 && password.length > 0 && !submitting;

  return (
    <AuthSplitLayout
      tone="founder"
      eyebrow="Waqf Trustee Platform"
      headline="A digital trustee for Islamic waqf."
      subcopy="Establish your own Foundation and Waqf Fund, self-service — Birr becomes Mutawalli (trustee) over what you establish, as you agree, no approval gate."
    >
      <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
        <IconMark className="h-9 w-9" />
        <span className="text-lg font-semibold tracking-tight text-slate-900">Birr</span>
      </Link>

      {step === "password" ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-500">
            First time?{" "}
            <Link href="/sign-up" className="font-medium text-primary-700 hover:text-primary-800">
              Create an account →
            </Link>
          </p>

          <form onSubmit={handlePasswordSubmit} className="mt-8 space-y-4">
            {error && (
              <Alert tone="danger" title="Couldn't sign in">
                {error}
              </Alert>
            )}
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-slate-700">
                Username or email
              </label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="primary" disabled={!canSubmitPassword} className="w-full">
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
