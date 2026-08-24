"use client";

// Landing page for an invitation link sent from /staff (Staff Management).
// The token in the URL is the credential — no session required to reach
// this page (see app-shell.tsx's PUBLIC_ROUTES), same posture as
// InvitationsController.accept on the backend. POST /invitations/accept
// sets the session cookie on success, so a successful accept logs the
// new staff member straight in.
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetchJson } from "../../lib/api";
import { Alert, Input } from "@birr/ui";

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitationContent />
    </Suspense>
  );
}

function AcceptInvitationContent() {
  const params = useSearchParams();
  const token = params.get("token");

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson("/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, fullName, password }),
      });
      // Full navigation — forces StaffSessionProvider to remount and pick
      // up the session cookie POST /invitations/accept just set.
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <CenteredCard>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Invalid invitation link</h1>
        <p className="mt-2 text-sm text-slate-500">This link is missing its invitation token.</p>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Join Birr</h1>
      <p className="mt-2 text-sm text-slate-500">Set your name and password to accept your invitation.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
        {error && (
          <Alert tone="danger" title="Couldn't accept invitation">
            {error}
          </Alert>
        )}
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="text-sm font-medium text-slate-700">
            Full name
          </label>
          <Input
            id="fullName"
            required
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-800 disabled:opacity-60"
        >
          {submitting ? "Joining…" : "Accept invitation"}
        </button>
      </form>
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        {children}
      </div>
    </div>
  );
}
