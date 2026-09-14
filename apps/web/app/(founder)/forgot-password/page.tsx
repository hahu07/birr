"use client";

// Self-service password recovery, step 1 of 2 (see reset-password/page.tsx
// for step 2). POST /founders/request-password-reset always returns
// {ok: true} whether or not the email matches a real account — this page
// shows the same "check your email" confirmation either way, so it can
// never be used to enumerate registered emails. Found missing entirely
// during a comprehensive Founder-side review (2026-09-14): a founder who
// forgot their password had no self-service fix, undercutting the
// platform's whole "self-service" pitch.
import Link from "next/link";
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, AuthSplitLayout, Button, IconMark, Input } from "@birr/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
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

      {sent ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Check your email</h1>
          <p className="mt-2 text-sm text-slate-500">
            If an account exists for <span className="font-medium text-slate-700">{email}</span>, we've sent a link
            to reset your password. It expires in 1 hour.
          </p>
          <Link href="/sign-in" className="mt-6 inline-block text-sm font-medium text-primary-700 hover:text-primary-800">
            ← Back to sign in
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Forgot your password?</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter the email on your account and we'll send you a link to reset your password.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && (
              <Alert tone="danger" title="Couldn't send reset link">
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <Button type="submit" variant="primary" disabled={submitting || email.trim().length === 0} className="w-full">
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
          </form>

          <p className="mt-6 text-sm text-slate-500">
            <Link href="/sign-in" className="font-medium text-primary-700 hover:text-primary-800">
              ← Back to sign in
            </Link>
          </p>
        </>
      )}
    </AuthSplitLayout>
  );
}
