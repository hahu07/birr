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
import { Card } from "@birr/ui";

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
              <>
                <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
                  Couldn&apos;t verify this link
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  This link may have expired or already been used. You can request a new one by signing up again.
                </p>
                <Link
                  href="/sign-up"
                  className="mt-4 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
                >
                  Back to sign up →
                </Link>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
