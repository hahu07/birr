"use client";

// Root 404 — without this, an unmatched path anywhere in the app (e.g. a
// plausible-but-wrong guess like /ops/approvals; the real route is
// /ops/governed-actions) falls through to Next's unstyled full-bleed
// default: no shell, no brand, no color. That's a jarring dead end in a
// product whose whole redesign is about not looking unfinished.
//
// A plain not-found.tsx nested under app/ops/ would NOT catch this case:
// Next only renders a segment's own not-found boundary for a `notFound()`
// call thrown from within an already-matched route in that segment, not
// for a URL that never matched a page at all — those fall straight to
// the nearest ancestor that GOT matched, which for a wrong /ops/* guess
// is the root layout. So this lives at the root and reads the current
// path itself to pick which brand voice to speak in.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconMark } from "@birr/ui";

export default function NotFound() {
  const pathname = usePathname();
  const isOps = pathname?.startsWith("/ops");

  return (
    <div
      className={`flex min-h-screen items-center justify-center px-6 ${isOps ? "ops-shell bg-primary-950" : "bg-white"}`}
    >
      <div className="mx-auto max-w-sm text-center">
        <IconMark className="mx-auto h-12 w-12" />
        <p
          className={`mt-6 text-xs font-semibold uppercase tracking-widest ${isOps ? "text-accent-400" : "text-primary-600"}`}
        >
          404
        </p>
        <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${isOps ? "text-white" : "text-slate-900"}`}>
          Page not found
        </h1>
        <p className={`mt-2 text-sm leading-relaxed ${isOps ? "text-primary-200" : "text-slate-500"}`}>
          {isOps
            ? "That's not a page in the Ops Console. Check the sidebar for what's actually there."
            : "That page doesn't exist, or the link is out of date."}
        </p>
        <Link
          href={isOps ? "/ops" : "/"}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-gradient-to-b from-primary-600 to-primary-700 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-primary-900/25 transition-colors hover:from-primary-700 hover:to-primary-800"
        >
          {isOps ? "Back to My Desk" : "Back to Birr"}
        </Link>
      </div>
    </div>
  );
}
