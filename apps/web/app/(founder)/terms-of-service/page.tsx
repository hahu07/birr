"use client";

// Placeholder page — see this footer link's own comment in SiteChrome.tsx.
// Public, reachable whether or not a founder session exists (see
// app-shell.tsx's PUBLIC_ROUTES), same posture as /privacy-policy and
// /waqf-types/. Deliberately NOT real legal copy — genuine terms of
// service for a fiduciary platform need to be drafted and reviewed by
// Birr's own legal counsel, not authored here. This page exists so the
// footer link works and visitors see an honest "this is coming" notice
// instead of a 404.
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../SiteChrome";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-6 py-20 sm:px-8">
        <Link href="/" className="text-sm font-medium text-primary-700 hover:text-primary-800">
          ← Back to Birr
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">Terms of Service</h1>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This page is a placeholder. Birr's real terms of service are being drafted with legal counsel and will
          replace this notice before the platform is used in production.
        </div>
        <div className="mt-8 space-y-4 text-sm leading-relaxed text-slate-600">
          <p>
            In the meantime, if you have a question about using Birr, contact us directly at{" "}
            <a href="mailto:info@birrwaqf.org" className="font-medium text-primary-700 hover:text-primary-800">
              info@birrwaqf.org
            </a>
            .
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
