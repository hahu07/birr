"use client";

// Client-side chrome + session gate. This is a dev-only stand-in for real
// route protection — once WorkOS/Auth0 lands, unauthenticated requests
// should be rejected before they ever reach a page component (middleware
// or a server-side check), not redirected client-side like this. See
// lib/founder-session.tsx and lib/api.ts for the matching notes.
//
// A real sidebar shell, mirroring apps/ops-console/app/app-shell.tsx's
// structure (same component family — NAV_ITEMS-driven Sidebar, session
// gate, sign-out) but calmer and less dense: this app has exactly one
// real destination today ("Overview"), and the audience (an institutional
// client checking in occasionally) doesn't need Ops Console's working
// density. Built data-driven off NAV_ITEMS so a "Request" or history view
// can be added later without restructuring the shell.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { Founder, useFounderSession } from "../lib/founder-session";
import { describeFounderKind } from "../lib/format";
import { ROUTE_FOR_STEP, useOnboardingStatus } from "../lib/onboarding";
import { OnboardingWizardChrome } from "./onboarding/OnboardingWizardChrome";
import { IconBriefcase, IconHome, IconLogOut, IconMark } from "@birr/ui";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: IconHome },
  { href: "/portfolio", label: "Portfolio", icon: IconBriefcase },
];

// Routes with their own full-screen layout, reachable whether or not a
// founder session exists — none of these should ever be wrapped in the
// authenticated sidebar shell (sign-up/verified are pre-session by
// definition; sign-in is the existing case this list previously
// hardcoded on its own).
const PUBLIC_ROUTES = ["/sign-in", "/sign-up", "/verified"];

// The one route that's public-OR-private depending on session, instead
// of purely one or the other: a signed-out visitor sees the marketing
// page here, a signed-in one sees the real dashboard — page.tsx itself
// does that branch. So unlike PUBLIC_ROUTES, "/" must never force-
// redirect to /sign-in when there's no session.
const HOME_ROUTE = "/";

// Reachable with a session but before onboarding finishes — a founder
// has zero access to the real dashboard (Overview/Portfolio/etc.) until
// all 4 steps are complete. "/contributions/" is a prefix match, not an
// exact one: a payment provider redirects here mid-step-3 regardless of
// exact wizard state, and the page is allowed to sit and poll.
const ONBOARDING_ROUTES = ["/onboarding/verify", "/onboarding/founder-foundation", "/onboarding/waqf-fund", "/onboarding/deed"];
function isOnboardingRoute(pathname: string) {
  return ONBOARDING_ROUTES.includes(pathname) || pathname.startsWith("/contributions/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, founder, loading, signOut } = useFounderSession();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isHomeRoute = pathname === HOME_ROUTE;
  const { status: onboarding, loading: onboardingLoading } = useOnboardingStatus(!loading && Boolean(user));

  useEffect(() => {
    if (!loading && !user && !isPublicRoute && !isHomeRoute) {
      router.replace("/sign-in");
    }
  }, [loading, user, isPublicRoute, isHomeRoute, router]);

  // Redirect between onboarding steps (or off them entirely once done)
  // — this is UX only, never the security boundary. Every backend write
  // path independently re-derives its own prerequisite (see
  // apps/backend/src/common/auth/current-founder.ts and each service's
  // own comments), so deleting this effect would degrade the UX but
  // change zero backend behavior.
  useEffect(() => {
    if (isPublicRoute || !user || onboardingLoading || !onboarding) return;

    if (!onboarding.onboardingComplete) {
      const targetRoute = onboarding.currentStep === "done" ? "/" : ROUTE_FOR_STEP[onboarding.currentStep];
      const onCorrectStep = pathname === targetRoute || pathname.startsWith("/contributions/");
      if (!onCorrectStep) {
        router.replace(targetRoute);
      }
    } else if (isOnboardingRoute(pathname)) {
      router.replace("/");
    }
  }, [isPublicRoute, user, onboarding, onboardingLoading, pathname, router]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  // No session at "/" — let page.tsx render the marketing page, no
  // chrome, no redirect (unlike every other private route below).
  if (isHomeRoute && !loading && !user) {
    return <>{children}</>;
  }

  if (loading || !user) {
    // Either still resolving the session, or about to be redirected to
    // /sign-in by the effect above — render nothing conspicuous either way.
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  if (onboardingLoading || !onboarding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  if (!onboarding.onboardingComplete) {
    // No Sidebar, no dashboard nav — zero access to the real dashboard
    // until all 4 steps are complete, per the onboarding requirement.
    return <OnboardingWizardChrome currentStep={onboarding.currentStep}>{children}</OnboardingWizardChrome>;
  }

  // onboardingComplete implies a Founder exists (step 2 is what creates
  // one) — this is just a type-level guard for TypeScript's benefit, not
  // a state this should ever actually reach.
  if (!founder) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.push("/sign-in");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar founder={founder} pathname={pathname} onSignOut={handleSignOut} />
      <div className="min-w-0 flex-1">
        <main className="px-6 py-12 sm:px-10 sm:py-16">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function Sidebar({
  founder,
  pathname,
  onSignOut,
}: {
  founder: Founder;
  pathname: string;
  onSignOut: () => void;
}) {
  return (
    // Collapses to an icon-only rail below `sm` (pure CSS, no added
    // interactive state) rather than a fixed-width rail overflowing a
    // phone-width viewport — the nav stays reachable, just compact.
    <aside className="flex w-16 shrink-0 flex-col border-r border-slate-200 bg-white sm:w-64">
      <div className="flex items-center justify-center gap-2.5 px-2 py-6 sm:justify-start sm:px-6">
        <IconMark className="h-9 w-9 shrink-0" />
        <div className="hidden sm:block">
          <p className="text-base font-semibold leading-tight tracking-tight text-slate-900">Birr</p>
          <p className="text-[11px] font-medium uppercase leading-tight tracking-wider text-slate-400">
            Founder Portal
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 px-2 py-4 sm:px-4">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={item.label}
              className={`flex items-center justify-center gap-3 rounded-md px-2 py-2.5 text-sm font-medium transition-colors sm:justify-start sm:px-3 ${
                isActive
                  ? "bg-primary-50 text-primary-800"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-primary-700" : "text-slate-400"}`} />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-2 sm:p-4">
        <div className="flex items-center justify-center gap-3 rounded-md px-1 py-2 sm:justify-start sm:px-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-800"
            title={founder.name}
          >
            {initials(founder.name)}
          </div>
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="truncate text-sm font-medium text-slate-800">{founder.name}</p>
            <p className="truncate text-xs text-slate-500">{describeFounderKind(founder)}</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-primary-700 sm:flex"
          >
            <IconLogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-primary-700 sm:hidden"
        >
          <IconLogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </aside>
  );
}
