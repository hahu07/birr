"use client";

import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, AuthSplitLayout, Button, IconMark, Input, PasswordInput } from "@birr/ui";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/birr-staff/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      // Full navigation, not router.push — forces StaffSessionProvider
      // to remount and re-fetch GET /birr-staff/me now that the session
      // cookie is set.
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

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-2 text-sm text-slate-500">Enter your Birr staff email and password.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
    </AuthSplitLayout>
  );
}
