"use client";

// Client-side chrome + session gate. This is a dev-only stand-in for real
// route protection — once WorkOS/Auth0 lands, unauthenticated requests
// should be rejected before they ever reach a page component (middleware
// or a server-side check), not redirected client-side like this. See
// lib/founder-session.tsx and lib/api.ts for the matching notes.
//
// A real sidebar shell, mirroring apps/web/app/ops/app-shell.tsx's
// structure (same component family — NAV_ITEMS-driven Sidebar, session
// gate, sign-out) but calmer and less dense: this route group has exactly
// one real destination today ("Overview"), and the audience (an
// institutional client checking in occasionally) doesn't need Ops
// Console's working density. Built data-driven off NAV_ITEMS so a
// "Request" or history view can be added later without restructuring
// the shell.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { Founder, SessionUser, useFounderSession } from "../../lib/founder-session";
import { ROUTE_FOR_STEP, useOnboardingStatus } from "../../lib/onboarding";
import { useNotifications } from "../../lib/notifications";
import { formatRelativeTime } from "../../lib/format";
import { OnboardingWizardChrome } from "./onboarding/OnboardingWizardChrome";
import {
  IconBriefcase,
  IconCheckCircle,
  IconClock,
  IconHome,
  IconLogOut,
  IconMark,
  IconMessageCircle,
  IconUsers,
  NotificationBell,
  type NotificationItem,
} from "@birr/ui";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: IconHome },
  { href: "/portfolio", label: "Portfolio", icon: IconBriefcase },
  { href: "/messages", label: "Messages", icon: IconMessageCircle },
  { href: "/impact", label: "Impact", icon: IconCheckCircle },
  { href: "/team", label: "Team", icon: IconUsers },
  { href: "/activity", label: "Activity", icon: IconClock },
];

// Routes with their own full-screen layout, reachable whether or not a
// founder session exists — none of these should ever be wrapped in the
// authenticated sidebar shell (sign-up/verified are pre-session by
// definition; sign-in is the existing case this list previously
// hardcoded on its own). /waqf-types/ is marketing content reached from
// the signed-out home page (see MarketingHome.tsx's summary cards) —
// public the same way, and public regardless of an in-progress
// founder's onboarding step too, or clicking through from "/" mid-
// onboarding would bounce them back to their wizard step instead.
// /vaults is the public "browse all open vaults" index and /vaults/
// is the per-vault donation page (app/vaults/page.tsx and
// app/vaults/[slug]/page.tsx) — no Founder session involved in either,
// same reasoning as /waqf-types/. /forgot-password and /reset-password
// (2026-09-14) are reachable by a locked-out founder with no session by
// definition — same posture as sign-up/verified above. /privacy-policy
// and /terms-of-service (2026-09-26) are footer links reachable from
// anywhere on the public site, same posture as /waqf-types/.
const PUBLIC_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/verified",
  "/vaults",
  "/forgot-password",
  "/reset-password",
  "/privacy-policy",
  "/terms-of-service",
];
const PUBLIC_ROUTE_PREFIXES = ["/waqf-types/", "/vaults/"];
function isPublicRoutePath(pathname: string) {
  return PUBLIC_ROUTES.includes(pathname) || PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

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
  const isPublicRoute = isPublicRoutePath(pathname);
  const isHomeRoute = pathname === HOME_ROUTE;
  const { status: onboarding, loading: onboardingLoading } = useOnboardingStatus(!loading && Boolean(user), pathname);
  const { notifications, unreadCount, loading: notificationsLoading, refresh, markRead, markAllRead } =
    useNotifications(!loading && Boolean(user) && Boolean(onboarding?.onboardingComplete));

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
  //
  // Forward is still gated (you can't skip ahead to a step you haven't
  // reached), but an already-completed earlier step is left alone
  // instead of being bounced straight back to the current one — a
  // founder can look back at a prior step (e.g. to double-check what
  // they entered) without the wizard fighting the navigation. Visiting
  // an earlier step doesn't let you redo it — establishment is
  // immediate and final (see each step's own page/service comments) —
  // it just stops "Back" from being a dead end.
  useEffect(() => {
    if (isPublicRoute || !user || onboardingLoading || !onboarding) return;

    if (!onboarding.onboardingComplete) {
      const targetRoute = onboarding.currentStep === "done" ? "/" : ROUTE_FOR_STEP[onboarding.currentStep];
      const currentStepIndex = onboarding.currentStep === "done" ? 4 : onboarding.currentStep;
      const pathnameStepEntry = (Object.entries(ROUTE_FOR_STEP) as [string, string][]).find(
        ([, route]) => route === pathname,
      );
      const isEarlierCompletedStep = pathnameStepEntry !== undefined && Number(pathnameStepEntry[0]) < currentStepIndex;
      const onAllowedRoute = pathname === targetRoute || pathname.startsWith("/contributions/") || isEarlierCompletedStep;
      if (!onAllowedRoute) {
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
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (onboardingLoading || !onboarding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading…</p>
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
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.push("/sign-in");
  }

  function handleSelectNotification(notification: NotificationItem) {
    markRead(notification.id);
    if (notification.linkUrl) router.push(notification.linkUrl);
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        user={user}
        founder={founder}
        pathname={pathname}
        unreadMessageCount={notifications.filter((n) => n.type === "message.received" && !n.readAt).length}
        onSignOut={handleSignOut}
        className="print:hidden"
      />
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-end border-b border-slate-200 bg-white px-4 py-2.5 sm:px-8 print:hidden">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            loading={notificationsLoading}
            onOpen={refresh}
            onSelect={handleSelectNotification}
            onMarkAllRead={markAllRead}
            formatTimestamp={formatRelativeTime}
          />
        </header>
        <main className="px-6 py-12 sm:px-10 sm:py-16 print:p-0">
          {/* max-w-6xl, matching the Ops Console shell's own content
              width — max-w-4xl left a wide, empty margin on anything
              wider than a laptop screen. Pages with their own narrower
              single-column form (foundations/new, waqf-funds/new,
              portfolio/[id]) still cap themselves further inside this,
              so this only widens pages that don't already opt into a
              narrower reading width. */}
          <div className="mx-auto max-w-6xl">{children}</div>
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
  user,
  founder,
  pathname,
  unreadMessageCount,
  onSignOut,
  className = "",
}: {
  user: SessionUser;
  founder: Founder;
  pathname: string;
  unreadMessageCount: number;
  onSignOut: () => void;
  className?: string;
}) {
  return (
    // Collapses to an icon-only rail below `sm` (pure CSS, no added
    // interactive state) rather than a fixed-width rail overflowing a
    // phone-width viewport — the nav stays reachable, just compact.
    //
    // Same deep teal/gold gradient rail as the Ops Console sidebar (see
    // apps/web/app/ops/app-shell.tsx's own comment) — one consistent
    // brand chrome across both surfaces, not two different products.
    // "Calmer and less dense" (this file's own top comment) is expressed
    // in nav item count and spacing, not in withholding color.
    <aside className={`flex w-16 shrink-0 flex-col bg-gradient-to-b from-primary-950 via-primary-900 to-primary-900 sm:w-64 ${className}`}>
      <div className="flex items-center justify-center gap-2.5 border-b border-white/10 bg-gradient-to-br from-accent-900/40 to-transparent px-2 py-6 sm:justify-start sm:px-6">
        <IconMark className="h-9 w-9 shrink-0" />
        <div className="hidden sm:block">
          <p className="text-base font-semibold leading-tight tracking-tight text-white">Birr</p>
          <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-accent-400">
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
                  ? "bg-gradient-to-r from-primary-600 to-primary-700 text-white shadow-sm"
                  : "text-primary-100/80 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-white" : "text-primary-300"}`} />
              <span className="hidden sm:inline">{item.label}</span>
              {item.href === "/messages" && unreadMessageCount > 0 && (
                <span className="ml-auto hidden h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white sm:flex">
                  {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-2 sm:p-4">
        <div className="flex items-center justify-center gap-3 rounded-md px-1 py-2 sm:justify-start sm:px-2">
          {/* Only the identity portion is a link — kept as a sibling of
              the sign-out button below, not a wrapper around it, so
              sign-out stays its own independent control rather than a
              button nested inside an anchor. */}
          <Link href="/account" title="Account & security" className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors hover:opacity-80">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-accent-600 text-xs font-semibold text-accent-950"
              title={user.fullName}
            >
              {initials(user.fullName)}
            </div>
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="truncate text-sm font-medium text-white">{user.fullName}</p>
              {/* The signed-in person, not the Foundation itself — now that
                  Team invites mean more than one person can share a
                  Founder account, showing founder.name here read as
                  "you're signed in as {founder.name}," which was only ever
                  true by coincidence for a lone individual founder. */}
              <p className="truncate text-xs text-primary-200/70">{founder.name}</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-primary-200/70 transition-colors hover:bg-white/10 hover:text-white sm:flex"
          >
            <IconLogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-md text-primary-200/70 transition-colors hover:bg-white/10 hover:text-white sm:hidden"
        >
          <IconLogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </aside>
  );
}
