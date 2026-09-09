"use client";

// Next.js's special root-level error boundary — the one place an error
// escaping RootLayout itself (not just a page) still gets caught rather
// than falling through to the browser's own unstyled error page. Renders
// its own <html>/<body> because it replaces the root layout entirely
// when it's active, so it imports globals.css directly rather than
// relying on layout.tsx, which isn't in the render tree at that point.
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 px-6 font-sans text-slate-900">
        <div className="mx-auto max-w-sm text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">Something went wrong</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">An unexpected error occurred</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            The error has been reported. You can try again, or come back later.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-primary-900/25 transition-colors hover:from-primary-700 hover:to-primary-800"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
