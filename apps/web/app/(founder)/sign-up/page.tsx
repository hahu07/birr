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
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { trackFunnelEvent } from "../../../lib/funnel-tracking";
import { Alert, AuthSplitLayout, Button, IconMark, Input, PasswordInput } from "@birr/ui";

export default function SignUpPage() {
  useEffect(() => {
    trackFunnelEvent("founder", "signup_started");
  }, []);

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
    password === confirmPassword &&
    acknowledged &&
    !submitting;

  return (
    <AuthSplitLayout
      tone="founder"
      eyebrow="Waqf Trustee Platform"
      headline="Establish your Foundation and Waqf Fund, self-service."
      subcopy="No approval gate — creating a Waqf Fund is itself how you agree Birr becomes Mutawalli (trustee) over it."
    >
      <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
        <IconMark className="h-9 w-9" />
        <span className="text-lg font-semibold tracking-tight text-slate-900">Birr</span>
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-2 text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-primary-700 hover:text-primary-800">
          Sign in
        </Link>
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-2.5">
        {submitError && (
          <Alert tone="danger" title="Couldn't create your account">
            {submitError}
          </Alert>
        )}

        <div>
          <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-slate-700">
            Full name
          </label>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <p className="mt-1 text-xs leading-snug text-slate-500">
            We'll send a verification link here — you'll need to confirm it before establishing a Foundation.
          </p>
        </div>
        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700">
            Username
          </label>
          <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <p className="mt-1 text-xs leading-snug text-slate-500">3-32 characters: letters, numbers, underscore, period, or hyphen.</p>
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
            Password
          </label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="mt-1 text-xs leading-snug text-slate-500">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <PasswordInput
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            error={confirmPassword.length > 0 && password !== confirmPassword ? "Passwords don't match." : undefined}
          />
        </div>

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
    </AuthSplitLayout>
  );
}
