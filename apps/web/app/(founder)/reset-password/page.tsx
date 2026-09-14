"use client";

// Self-service password recovery, step 2 (see forgot-password/page.tsx
// for step 1) — reached by clicking the link in the reset email
// (?token=...). Suspense wrapper for useSearchParams follows the same
// pattern as app/verified/page.tsx.
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetchJson } from "../../../lib/api";
import { Alert, AuthSplitLayout, Button, IconMark, PasswordInput } from "@birr/ui";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

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

      {!token ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Missing reset link</h1>
          <p className="mt-2 text-sm text-slate-500">
            This page needs the link from your password reset email — request a new one below.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            Request a new link →
          </Link>
        </>
      ) : done ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Password reset</h1>
          <p className="mt-2 text-sm text-slate-500">Your password has been changed. Sign in with your new password.</p>
          <Link href="/sign-in" className="mt-6 inline-block text-sm font-medium text-primary-700 hover:text-primary-800">
            Go to sign in →
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Choose a new password</h1>
          <p className="mt-2 text-sm text-slate-500">Enter and confirm your new password below.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && (
              <Alert tone="danger" title="Couldn't reset password">
                {error}
              </Alert>
            )}
            <div>
              <label htmlFor="newPassword" className="mb-1.5 block text-sm font-medium text-slate-700">
                New password
              </label>
              <PasswordInput
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
                required
                minLength={8}
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-slate-700">
                Confirm new password
              </label>
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || newPassword.length === 0 || confirmPassword.length === 0}
              className="w-full"
            >
              {submitting ? "Resetting…" : "Reset password"}
            </Button>
          </form>
        </>
      )}
    </AuthSplitLayout>
  );
}
