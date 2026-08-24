"use client";

// Real, first-time account creation — identity + credentials only.
// Founder identity/Foundation/logo moved to the merged onboarding step
// (app/onboarding/founder-foundation/page.tsx) once email + WhatsApp are
// verified — see lib/onboarding.ts's ROUTE_FOR_STEP for why sign-up
// itself stays this narrow now. Signing up also logs the user in
// immediately (the backend sets a session cookie right after this
// succeeds), so on success we redirect straight into the app rather than
// a dead-end "check your email" screen — the onboarding wizard's own
// step 1 page shows that "verify your email" state itself.
import Link from "next/link";
import { useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { Alert, Button, Card, Input } from "@birr/ui";

export default function SignUpPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (password !== confirmPassword) {
      setSubmitError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/sign-up", {
        method: "POST",
        body: JSON.stringify({ fullName, email, username, password }),
      });
      window.location.href = "/";
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const canSubmit =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    username.trim().length > 0 &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    acknowledged &&
    !submitting;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <p className="text-lg font-semibold tracking-tight text-primary-800">Birr</p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">Create your account</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
            Birr is a digital trustee for Islamic waqf. Creating your account is the first step — you'll establish
            your Foundation and Waqf Fund next, self-service, no approval gate.
          </p>
        </div>

        {submitError && (
          <Alert tone="danger" title="Couldn't create your account" className="mb-6">
            {submitError}
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <div className="space-y-4">
              <div>
                <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Full name
                </label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <p className="mt-1.5 text-xs text-slate-500">
                  We'll send a verification link here — you'll need to confirm it before establishing a Foundation.
                </p>
              </div>
              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Username
                </label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
                <p className="mt-1.5 text-xs text-slate-500">3-32 characters: letters, numbers, underscore, period, or hyphen.</p>
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="mt-1.5 text-xs text-slate-500">At least 8 characters.</p>
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Confirm password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>
          </Card>

          <label className="flex items-start gap-2.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span>
              Birr becomes Mutawalli (trustee) over any Foundation or Waqf Fund I establish through this account.
            </span>
          </label>

          <Button type="submit" variant="primary" disabled={!canSubmit} className="w-full">
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-primary-700 hover:text-primary-800">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
