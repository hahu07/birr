"use client";

// Real username/password login — POST /founders/login sets the httpOnly
// session cookie (see lib/api.ts, apps/backend/src/common/auth/session.ts).
import Link from "next/link";
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, AuthSplitLayout, Button, IconMark, Input, PasswordInput } from "@birr/ui";

export default function SignInPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting;

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

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
      <p className="mt-2 text-sm text-slate-500">
        First time?{" "}
        <Link href="/sign-up" className="font-medium text-primary-700 hover:text-primary-800">
          Create an account →
        </Link>
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
        <Button type="submit" variant="primary" disabled={!canSubmit} className="w-full">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthSplitLayout>
  );
}
