"use client";

// Client-side chrome + session gate. This is a dev-only stand-in for real
// route protection — once WorkOS/Auth0 lands, unauthenticated requests
// should be rejected before they ever reach a page component (middleware
// or a server-side check), not redirected client-side like this. See
// lib/founder-session.tsx and lib/api.ts for the matching notes.
//
// The signed-in shell, mirroring apps/web/app/ops/app-shell.tsx's
// structure (NAV_GROUPS-driven Sidebar, session gate, sign-out) but
// calmer: the audience is an institutional client checking in, not an
// officer working a queue. Three layouts by width: a bottom tab bar on
// phones (below md), an icon rail on tablets (md), the full labelled
// sidebar from lg up — with a sticky, translucent top bar throughout.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { Founder, SessionUser, useFounderSession } from "../../lib/founder-session";
import { ROUTE_FOR_STEP, useOnboardingStatus } from "../../lib/onboarding";
import { useNotifications } from "../../lib/notifications";
import { formatRelativeTime } from "../../lib/format";
import { OnboardingWizardChrome } from "./onboarding/OnboardingWizardChrome";
import {
  IconBriefcase,
  IconClock,
  IconHeart,
  IconHome,
  IconLogOut,
  IconMark,
  IconMessageCircle,
  IconMoreHorizontal,
  IconSettings,
  IconUsers,
  NotificationBell,
  type NotificationItem,
} from "@birr/ui";

const NAV_GROUPS = [
  {
    label: "Endowment",
    items: [
      { href: "/", label: "Overview", icon: IconHome },
      { href: "/portfolio", label: "Portfolio", icon: IconBriefcase },
      { href: "/impact", label: "Impact", icon: IconHeart },
    ],
  },
  {
    label: "Collaborate",
    items: [
      { href: "/messages", label: "Messages", icon: IconMessageCircle },
      { href: "/team", label: "Team", icon: IconUsers },
    ],
  },
  {
    label: "Records",
    items: [{ href: "/activity", label: "Activity", icon: IconClock }],
  },
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
// same reasoning as /waqf-types/. /vault-contributions/ (2026-09-29) is
// where a Vault donor's payment provider redirects back to after
// checkout — same "no Founder session, ever" reasoning as /vaults/
// itself; before this was added here, a Vault donor with no session hit
// this effect's redirect below and was bounced to /sign-in immediately
// after paying, with no confirmation of any kind (see that page's own
// comment). /forgot-password and /reset-password
// (2026-09-14) are reachable by a locked-out founder with no session by
// definition — same posture as sign-up/verified above. /privacy-policy
// and /terms-of-service (2026-09-26) are footer links reachable from
// anywhere on the public site, same posture as /waqf-types/. /blog and
// /blog/ (2026-10-01) are the public educational articles — same
// posture again, no Founder session involved.
const PUBLIC_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/verified",
  "/vaults",
  "/forgot-password",
  "/reset-password",
  "/privacy-policy",
  "/terms-of-service",
  "/blog",
];
const PUBLIC_ROUTE_PREFIXES = ["/waqf-types/", "/vaults/", "/vault-contributions/", "/blog/"];
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

  // Public pages (marketing home, Vault giving, blog, legal, auth) get
  // the Founder Portal's type too — .founder-app only scopes the fonts,
  // it adds no chrome (2026-10 redesign, public-site phase).
  if (isPublicRoute) {
    return <div className="founder-app">{children}</div>;
  }

  // No session at "/" — let page.tsx render the marketing page, no
  // chrome, no redirect (unlike every other private route below).
  if (isHomeRoute && !loading && !user) {
    return <div className="founder-app">{children}</div>;
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

  const unreadMessageCount = notifications.filter((n) => n.type === "message.received" && !n.readAt).length;

  return (
    // .founder-app opts this signed-in surface into the Founder Portal's
    // own type (see globals.css) — the public pages above return earlier
    // and keep theirs.
    <div className="founder-app flex min-h-screen bg-slate-50">
      <Sidebar
        user={user}
        founder={founder}
        pathname={pathname}
        unreadMessageCount={unreadMessageCount}
        onSignOut={handleSignOut}
        className="print:hidden"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 sm:px-6 lg:px-10 print:hidden">
          {/* Below md the sidebar is replaced by the bottom tab bar, so the
              brand mark moves up here instead. */}
          <Link href="/" className="flex items-center gap-2 md:hidden" aria-label="Birr — Overview">
            <IconMark className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">Birr</span>
          </Link>
          <p className="hidden truncate text-sm text-slate-500 md:block">
            <span className="text-slate-400">Founder Portal</span>
            <span className="mx-2 text-slate-300">/</span>
            <span className="font-medium text-slate-800">{sectionTitle(pathname)}</span>
          </p>
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
        {/* pb-28 below md clears the fixed bottom tab bar. */}
        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pb-12 lg:px-10 lg:pt-10 print:p-0">
          {/* max-w-6xl, matching the Ops Console shell's own content
              width. Pages with their own narrower single-column form
              (foundations/new, waqf-funds/new, portfolio/[id]) still cap
              themselves further inside this. */}
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
      <MobileTabBar pathname={pathname} unreadMessageCount={unreadMessageCount} onSignOut={handleSignOut} />
    </div>
  );
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** The top bar's "Founder Portal / {section}" label. */
function sectionTitle(pathname: string): string {
  if (pathname.startsWith("/foundations")) return "Portfolio";
  if (pathname.startsWith("/account")) return "Account & security";
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => isActivePath(pathname, i.href));
  return item?.label ?? "Overview";
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
    // Hidden below md (the bottom tab bar takes over — a 64px icon rail
    // on a 360px phone left content ~250px wide). An icon-only rail from
    // md to lg, the full labelled sidebar from lg up. Sticky, so the nav
    // stays put while a long page scrolls.
    //
    // Same deep teal/gold gradient as the Ops Console sidebar (see
    // apps/web/app/ops/app-shell.tsx) — one brand chrome across both.
    <aside
      className={`sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col bg-gradient-to-b from-primary-950 via-primary-900 to-primary-950 md:flex lg:w-64 ${className}`}
    >
      <div className="flex h-14 items-center justify-center gap-2.5 border-b border-white/10 px-3 lg:justify-start lg:px-6">
        <IconMark className="h-8 w-8 shrink-0" />
        <div className="hidden lg:block">
          <p className="text-[15px] font-semibold leading-tight tracking-tight text-white">Birr</p>
          <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-accent-400">
            Founder Portal
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5 lg:px-4" aria-label="Founder Portal">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-6 last:mb-0">
            <p className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-300/60 lg:block">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const isActive = isActivePath(pathname, item.href);
                const Icon = item.icon;
                const showUnread = item.href === "/messages" && unreadMessageCount > 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      title={item.label}
                      className={`group relative flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:justify-start ${
                        isActive ? "bg-white/10 text-white" : "text-primary-100/75 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent-400" aria-hidden="true" />
                      )}
                      <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-accent-300" : "text-primary-300 group-hover:text-primary-100"}`} />
                      <span className="hidden lg:inline">{item.label}</span>
                      {showUnread && (
                        <>
                          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent-400 lg:hidden" aria-hidden="true" />
                          <span className="ml-auto hidden h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-400 px-1.5 text-[10px] font-bold leading-none text-accent-950 lg:flex">
                            {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                          </span>
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3 lg:p-4">
        <div className="flex flex-col items-center gap-2 lg:flex-row lg:gap-3">
          {/* Only the identity portion is a link — a sibling of the
              sign-out button, not a wrapper around it, so sign-out stays
              its own control rather than a button nested in an anchor. */}
          <Link
            href="/account"
            title="Account & security"
            className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-white/5 ${
              pathname.startsWith("/account") ? "bg-white/10" : ""
            }`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-300 to-accent-500 text-xs font-bold text-accent-950 ring-2 ring-white/10">
              {initials(user.fullName)}
            </div>
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="truncate text-sm font-medium text-white">{user.fullName}</p>
              {/* The signed-in person, not the Foundation — with Team
                  invites, more than one person can share a Founder. */}
              <p className="truncate text-xs text-primary-200/70">{founder.name}</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary-200/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconLogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );
}

const MOBILE_TABS = [
  { href: "/", label: "Overview", icon: IconHome },
  { href: "/portfolio", label: "Portfolio", icon: IconBriefcase },
  { href: "/impact", label: "Impact", icon: IconHeart },
  { href: "/messages", label: "Messages", icon: IconMessageCircle },
];
const MORE_LINKS = [
  { href: "/team", label: "Team", icon: IconUsers },
  { href: "/activity", label: "Activity", icon: IconClock },
  { href: "/account", label: "Account & security", icon: IconSettings },
];

/**
 * Phone navigation (below md): four primary destinations plus "More",
 * which opens a sheet with the rest and sign-out. Fixed to the bottom,
 * padded for the home-indicator safe area.
 */
function MobileTabBar({
  pathname,
  unreadMessageCount,
  onSignOut,
}: {
  pathname: string;
  unreadMessageCount: number;
  onSignOut: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_LINKS.some((l) => isActivePath(pathname, l.href));

  // Closed by any link tap below, the backdrop, or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <div className="md:hidden print:hidden">
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={() => setMoreOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More"
            className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/20"
          >
            {MORE_LINKS.map((l) => {
              const Icon = l.icon;
              const active = isActivePath(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] font-medium ${
                    active ? "bg-primary-50 text-primary-800" : "text-slate-800 active:bg-slate-100"
                  }`}
                >
                  <Icon className="h-5 w-5 text-slate-500" />
                  {l.label}
                </Link>
              );
            })}
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] font-medium text-red-700 active:bg-red-50"
            >
              <IconLogOut className="h-5 w-5" />
              Sign out
            </button>
          </div>
        </>
      )}
      <nav
        aria-label="Founder Portal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <ul className="grid grid-cols-5">
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isActivePath(pathname, tab.href);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                    active ? "text-primary-700" : "text-slate-500"
                  }`}
                >
                  {active && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-primary-600" aria-hidden="true" />}
                  <span className="relative">
                    <Icon className="h-[22px] w-[22px]" />
                    {tab.href === "/messages" && unreadMessageCount > 0 && (
                      <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-accent-500" aria-label="Unread messages" />
                    )}
                  </span>
                  {tab.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                moreOpen || moreActive ? "text-primary-700" : "text-slate-500"
              }`}
            >
              {moreActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-primary-600" aria-hidden="true" />}
              <IconMoreHorizontal className="h-[22px] w-[22px]" />
              More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
