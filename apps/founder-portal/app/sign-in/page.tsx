"use client";

// Real username/password login — POST /founders/login sets the httpOnly
// session cookie (see lib/api.ts, apps/backend/src/common/auth/session.ts).
// Replaces the old dev "pick a founder from a list" stand-in entirely.
import Link from "next/link";
import { useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { Alert, Button, Card, Input } from "@birr/ui";

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-lg font-semibold tracking-tight text-primary-800">Birr</p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
            Sign in to the Founder Portal
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            First time?{" "}
            <Link href="/sign-up" className="font-medium text-primary-700 hover:text-primary-800">
              Create an account →
            </Link>
          </p>
        </div>

        <Card>
          {error && (
            <Alert tone="danger" title="Couldn't sign in" className="mb-6">
              {error}
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-slate-700">
                Username
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
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="primary" disabled={!canSubmit} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
