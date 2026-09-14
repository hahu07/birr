"use client";

// Landing target for GET /founders/verify-email's redirect (clicked from
// an email client, so the backend redirects here rather than returning
// JSON). No id to store client-side any more — the session cookie set
// at sign-up already identifies who this is (see lib/founder-session.tsx),
// so a successful verification just needs to send the browser back in;
// app-shell.tsx re-fetches session/onboarding status on its own.
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetchJson } from "../../../lib/api";
import { Alert, Button, Card } from "@birr/ui";

export default function VerifiedPage() {
  return (
    <Suspense fallback={null}>
      <VerifiedPageContent />
    </Suspense>
  );
}

function VerifiedPageContent() {
  const params = useSearchParams();
  const [redirecting, setRedirecting] = useState(false);

  const ok = params.get("ok") === "1";

  useEffect(() => {
    if (ok) {
      setRedirecting(true);
      window.location.href = "/";
    }
  }, [ok]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center">
            <p className="text-lg font-semibold tracking-tight text-primary-800">Birr</p>
            {ok ? (
              <>
                <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">Email verified</h1>
                <p className="mt-2 text-sm text-slate-500">
                  {redirecting ? "Taking you to your Founder Portal…" : "Redirecting…"}
                </p>
              </>
            ) : (
              <VerificationFailed />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// 2026-09-14 audit fix: "sign up again" used to be offered here as the
// fix — but sign-up always logs a founder in immediately (see
// FoundersService.signUp()'s own comment), so the account from the
// original sign-up is already real, and signing up again just fails
// with "an account already exists." The actual fix, same one
// onboarding/verify/page.tsx's CheckYourEmail already uses, is to
// resend the link — the still-live session cookie from the original
// sign-up (7-day validity, comfortably outliving the 24h verification
// window) makes this work in the realistic case of the same browser
// clicking an old/expired link. If there's truly no session (a
// different device, or the cookie's gone), the resend call 401s and
// this falls back to pointing at sign-in — never sign-up, which would
// only recreate the same dead end.
function VerificationFailed() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    setStatus("sending");
    setError(null);
    try {
      await apiFetchJson("/founders/resend-verification-email", { method: "POST" });
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">Couldn&apos;t verify this link</h1>
      <p className="mt-2 text-sm text-slate-500">This link may have expired or already been used.</p>

      {status === "sent" ? (
        <Alert tone="success" title="Email sent" className="mt-4 text-left">
          Check your inbox for a new verification link.
        </Alert>
      ) : (
        <>
          {status === "error" && (
            <Alert tone="danger" title="Couldn't resend" className="mt-4 text-left">
              {error} If you're on a different device than the one you signed up with, sign in first, then request
              a new link from there.
            </Alert>
          )}
          <Button type="button" variant="secondary" onClick={handleResend} disabled={status === "sending"} className="mt-4">
            {status === "sending" ? "Sending…" : "Resend verification email"}
          </Button>
        </>
      )}

      <p className="mt-4">
        <Link href="/sign-in" className="text-sm font-medium text-primary-700 hover:text-primary-800">
          Back to sign in →
        </Link>
      </p>
    </>
  );
}
