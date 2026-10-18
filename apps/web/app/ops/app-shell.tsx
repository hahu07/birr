"use client";

// Client-side nav chrome + session gate. The real enforcement is on the
// backend (SessionAuthGuard, PermissionGuard, StaffRoleGuard — see
// apps/backend/src/common/guards) — every request is checked there
// regardless of what this component does. This redirect is a UX
// convenience only: it keeps a signed-out visitor from seeing a page
// flash before its data fetches start failing with 401s, nothing more.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { BirrStaff, useStaffSession } from "../../lib/staff-session";
import { apiFetchJson } from "../../lib/api";
import { formatRelativeTime, humanizeRoles } from "../../lib/format";
import { useNotifications } from "../../lib/notifications";
import type { GovernedAction, WaqfCaseAssignment } from "../../lib/ops-types";
import {
  IconArchive,
  IconBriefcase,
  IconChevronDown,
  IconClipboardCheck,
  IconFileText,
  IconGlobe,
  IconHome,
  IconInbox,
  IconKey,
  IconLandmark,
  IconLogOut,
  IconMark,
  IconMenu,
  IconMessageCircle,
  IconSettings,
  IconShieldAlert,
  IconSparkle,
  IconUsers,
  IconX,
  NotificationBell,
  type NotificationItem,
} from "@birr/ui";

// Grouped like a normal SaaS admin nav (section label + items) instead
// of one flat list — easier to scan as the item count grows. Labels
// favor plain language over internal jargon where the term is purely
// operational ("My Desk", "Approvals", "Team", "Settings"); precise
// governance/compliance terms (Conflicts of Interest, Audit Log,
// Jurisdictions) are left as-is deliberately — those are the actual
// regulatory/fiduciary vocabulary and softening them would cost clarity
// for no benefit.
const NAV_GROUPS: {
  label: string;
  items: { href: string; label: string; icon: typeof IconInbox; requiresPermission?: string; requiresCaseload?: boolean }[];
}[] = [
  {
    label: "Overview",
    items: [
      { href: "/ops", label: "Overview", icon: IconHome },
      // Only shown to a staff member who actually has at least one
      // waqf_case_assignment — see Sidebar()'s own filter below and
      // AppShell's hasCaseload fetch. A staff member with none never
      // sees an empty "My Desk" link at all.
      { href: "/ops/my-desk", label: "My Desk", icon: IconInbox, requiresCaseload: true },
      { href: "/ops/messages", label: "Messages", icon: IconMessageCircle },
      { href: "/ops/funnel-report", label: "Funnel Report", icon: IconClipboardCheck },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/ops/governed-actions", label: "Approvals", icon: IconClipboardCheck },
      { href: "/ops/founder-requests", label: "Founder Requests", icon: IconInbox },
      { href: "/ops/conflict-of-interest", label: "Conflicts of Interest", icon: IconShieldAlert },
      { href: "/ops/ai-agents", label: "AI Agents", icon: IconSparkle },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { href: "/ops/foundations", label: "Foundations", icon: IconLandmark },
      { href: "/ops/waqfs", label: "Waqf Funds", icon: IconBriefcase },
      { href: "/ops/vaults", label: "Vaults", icon: IconArchive },
      { href: "/ops/counterparties", label: "Counterparties", icon: IconLandmark },
      { href: "/ops/cause-categories", label: "Cause Categories", icon: IconSparkle },
      // Public blog articles — shown to whoever holds blog.manage, the same
      // permission BlogController requires (UX only; the backend enforces it).
      {
        href: "/ops/articles",
        label: "Articles",
        icon: IconFileText,
        requiresPermission: "blog.manage",
      },
      { href: "/ops/vault-ledger-accounts", label: "Vault Ledger Accounts", icon: IconFileText },
      { href: "/ops/waqf-ledger-accounts", label: "Waqf Ledger Accounts", icon: IconFileText },
    ],
  },
  {
    label: "Compliance",
    items: [
      { href: "/ops/jurisdictions", label: "Jurisdictions", icon: IconGlobe },
      { href: "/ops/shariah-prohibited-sectors", label: "Shariah Prohibited Sectors", icon: IconShieldAlert },
      { href: "/ops/audit-logs", label: "Audit Log", icon: IconFileText },
      { href: "/ops/vault-compliance-review", label: "Vault Giving Review", icon: IconShieldAlert },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/ops/staff", label: "Team", icon: IconUsers },
      // Open to every staff role — see roles.controller.ts's own comment
      // on why this one isn't platform_admin-gated like its siblings.
      { href: "/ops/roles", label: "Roles & Access", icon: IconKey },
      // Backend enforces platform_admin-only via StaffRoleGuard regardless
      // of this filtering — see Sidebar()'s own filter below, which is UX
      // only (no reason to show a nav item that 403s for everyone else).
      { href: "/ops/platform-settings", label: "Settings", icon: IconSettings, requiresPermission: "platform_settings.manage" },
      { href: "/ops/waqf-funding", label: "Waqf Funding", icon: IconSettings, requiresPermission: "waqf_funding.configure" },
    ],
  },
];

// Routes reachable with no BirrStaff session — /ops/sign-in (obviously,
// and deliberately unlinked from anywhere public — see this merge's
// plan notes), and /ops/accept-invitation (a new invitee has no account
// yet; the token in the URL is their credential, same posture as
// InvitationsController.accept on the backend).
const PUBLIC_ROUTES = ["/ops/sign-in", "/ops/accept-invitation"];
const HOME_ROUTE = "/ops";
const SIGN_IN_ROUTE = "/ops/sign-in";
// The forced-enrollment screen a signed-in staff member with
// mfaEnabled: false is redirected to below — real enforcement is
// SessionAuthGuard's own MFA check on the backend (see that guard's
// comment); this redirect is the same UX-convenience layer the
// sign-in redirect above already is for the plain signed-out case.
const MFA_EXEMPT_ROUTES = ["/ops/mfa-setup"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { staff, loading, signOut } = useStaffSession();
  // usePathname() never includes the query string, so a plain equality
  // check is enough even for /accept-invitation?token=....
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isMfaExemptRoute = MFA_EXEMPT_ROUTES.includes(pathname);
  const { notifications, unreadCount, loading: notificationsLoading, refresh, markRead, markAllRead } =
    useNotifications(!loading && Boolean(staff));

  // Drives the "My Desk" nav item's visibility (see NAV_GROUPS'
  // requiresCaseload) — a staff member with nothing currently on their
  // desk never sees the link at all. "Currently" means anything other
  // than closed — active (in progress) or reassigned (still theirs
  // until the handoff is settled) both count; a staff member whose
  // every assignment has since been closed goes back to not seeing it,
  // same as someone who never had one — the point is "is there
  // something to look at right now," not "did this staff member ever
  // touch a case." Fetched once per session here, not inside
  // my-desk/page.tsx itself, since the nav needs to know this before
  // that page is ever visited.
  const [hasCaseload, setHasCaseload] = useState(false);
  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    apiFetchJson<WaqfCaseAssignment[]>(`/waqf-case-assignments?birrStaffId=${staff.id}`)
      .then((data) => {
        if (!cancelled) setHasCaseload(data.some((c) => c.status !== "closed"));
      })
      .catch(() => {
        if (!cancelled) setHasCaseload(false);
      });
    return () => {
      cancelled = true;
    };
  }, [staff]);

  // Approvals nav badge: proposed governed actions this staff member can
  // actually decide — their own proposals excluded, since maker ≠ checker
  // (CLAUDE.md) means they could never approve those. Refreshed on every
  // navigation so it falls as decisions are made; a failed fetch just
  // hides the badge (it's a hint, never the source of truth — the queue
  // page itself is).
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed")
      .then((actions) => {
        if (!cancelled) setPendingApprovals(actions.filter((a) => a.makerUserId !== staff.userId).length);
      })
      .catch(() => {
        if (!cancelled) setPendingApprovals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [staff, pathname]);

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!loading && !staff && !isPublicRoute) {
      router.replace(SIGN_IN_ROUTE);
    }
  }, [loading, staff, isPublicRoute, router]);

  useEffect(() => {
    if (!loading && staff && !staff.user.mfaEnabled && !isMfaExemptRoute) {
      router.replace("/ops/mfa-setup");
    }
  }, [loading, staff, isMfaExemptRoute, router]);

  if (isPublicRoute || isMfaExemptRoute) {
    return <>{children}</>;
  }

  if (loading || !staff || !staff.user.mfaEnabled) {
    // Still resolving, about to be redirected to /sign-in, or about to
    // be redirected to /mfa-setup by one of the effects above — render
    // nothing conspicuous (specifically: no authenticated nav chrome)
    // in any of those cases.
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.push(SIGN_IN_ROUTE);
  }

  function handleSelectNotification(notification: NotificationItem) {
    markRead(notification.id);
    if (notification.linkUrl) router.push(notification.linkUrl);
  }

  const navProps = {
    staff,
    pathname,
    hasCaseload,
    pendingApprovals,
    unreadMessageCount: notifications.filter((n) => n.type === "message.received" && !n.readAt).length,
    onSignOut: handleSignOut,
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar {...navProps} />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} {...navProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
            >
              <IconMenu className="h-5 w-5" />
            </button>
            <p className="truncate text-sm text-slate-500">
              <span className="hidden text-slate-400 sm:inline">Ops Console</span>
              <span className="mx-2 hidden text-slate-300 sm:inline">/</span>
              <span className="font-medium text-slate-800">{sectionTitle(pathname)}</span>
            </p>
          </div>
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
        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
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

function isActivePath(pathname: string, href: string): boolean {
  return href === HOME_ROUTE ? pathname === HOME_ROUTE : pathname.startsWith(href);
}

/** The top bar's "Ops Console / {section}" label — the nav item the current route sits under. */
function sectionTitle(pathname: string): string {
  if (pathname.startsWith("/ops/profile")) return "My Profile";
  const items = NAV_GROUPS.flatMap((g) => g.items).filter((i) => isActivePath(pathname, i.href));
  // Longest match wins (/ops/waqf-ledger-accounts over /ops/waqfs's sibling prefixes).
  return items.sort((a, b) => b.href.length - a.href.length)[0]?.label ?? "Overview";
}

interface NavProps {
  staff: BirrStaff;
  pathname: string;
  hasCaseload: boolean;
  pendingApprovals: number | null;
  unreadMessageCount: number;
  onSignOut: () => void;
}

const COLLAPSED_GROUPS_KEY = "birr.ops.collapsedNavGroups";

/**
 * The nav itself — shared by the desktop Sidebar (labels from lg, icon
 * rail at md) and the phone MobileDrawer (always labelled). Groups can be
 * collapsed (remembered per browser; storage failures just mean nothing
 * is remembered); the group holding the current page is always open.
 */
function NavList({ pathname, hasCaseload, pendingApprovals, unreadMessageCount, labelled, onNavigate }: NavProps & { labelled: "always" | "lg"; onNavigate?: () => void }) {
  const { can } = useStaffSession();
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  function toggle(label: string) {
    setCollapsed((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Private mode / blocked storage — collapsing still works for this page view.
      }
      return next;
    });
  }
  const showLabel = labelled === "always" ? "" : "hidden lg:inline";
  const showBlock = labelled === "always" ? "flex" : "hidden lg:flex";

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Ops Console">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(
          (item) =>
            (!item.requiresPermission || can(item.requiresPermission)) &&
            (!item.requiresCaseload || hasCaseload),
        );
        if (items.length === 0) return null;
        const holdsActive = items.some((i) => isActivePath(pathname, i.href));
        const open = holdsActive || !collapsed.includes(group.label);
        return (
          <div key={group.label}>
            <button
              type="button"
              onClick={() => toggle(group.label)}
              disabled={holdsActive}
              aria-expanded={open}
              className={`${showBlock} w-full items-center justify-between rounded px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-300/90 hover:text-accent-200 disabled:cursor-default disabled:hover:text-accent-300/90`}
            >
              {group.label}
              {!holdsActive && <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />}
            </button>
            {open && (
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const isActive = isActivePath(pathname, item.href);
                  const Icon = item.icon;
                  const count =
                    item.href === "/ops/messages" ? unreadMessageCount : item.href === "/ops/governed-actions" ? (pendingApprovals ?? 0) : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={isActive ? "page" : undefined}
                        title={item.label}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          labelled === "always" ? "" : "justify-center lg:justify-start"
                        } ${isActive ? "bg-white/10 text-white" : "text-primary-100/75 hover:bg-white/5 hover:text-white"}`}
                      >
                        {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent-400" aria-hidden="true" />}
                        <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-accent-300" : "text-primary-300 group-hover:text-primary-100"}`} />
                        <span className={`truncate ${showLabel}`}>{item.label}</span>
                        {count > 0 && (
                          <>
                            <span
                              className={`ml-auto h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-400 px-1.5 text-[10px] font-bold leading-none text-accent-950 ${showBlock}`}
                              title={item.href === "/ops/governed-actions" ? "Awaiting a decision you can make (excludes your own proposals)" : "Unread"}
                            >
                              {count > 99 ? "99+" : count}
                            </span>
                            {labelled === "lg" && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-400 lg:hidden" aria-hidden="true" />}
                          </>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ labelled }: { labelled: "always" | "lg" }) {
  return (
    <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-4 ${labelled === "always" ? "" : "justify-center lg:justify-start lg:px-5"}`}>
      <IconMark className="h-8 w-8 shrink-0" />
      <div className={labelled === "always" ? "" : "hidden lg:block"}>
        <p className="text-[15px] font-semibold leading-tight tracking-tight text-white">Birr</p>
        <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-accent-400">Ops Console</p>
      </div>
    </div>
  );
}

function ProfileFooter({ staff, onSignOut, labelled, onNavigate }: Pick<NavProps, "staff" | "onSignOut"> & { labelled: "always" | "lg"; onNavigate?: () => void }) {
  return (
    <div className="shrink-0 border-t border-white/10 p-3">
      <div className={`flex items-center gap-2 ${labelled === "always" ? "" : "flex-col lg:flex-row"}`}>
        <Link href="/ops/profile" onClick={onNavigate} title="My Profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-white/5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-300 to-accent-500 text-xs font-bold text-primary-950 ring-2 ring-white/10">
            {initials(staff.user.fullName)}
          </div>
          <div className={`min-w-0 flex-1 ${labelled === "always" ? "" : "hidden lg:block"}`}>
            <p className="truncate text-sm font-medium text-white">{staff.user.fullName}</p>
            <p className="truncate text-xs text-primary-300">{humanizeRoles(staff.roles)}</p>
          </div>
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <IconLogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}

function Sidebar(props: NavProps) {
  return (
    // Hidden below md (MobileDrawer instead — a 64px rail for 20+ nav
    // items left a phone-width page ~250px wide). Icon rail from md,
    // labelled from lg; sticky so the nav stays put while a page scrolls.
    //
    // A deep, deliberately colorful rail (primary-950 → primary-900) —
    // the most-visible, always-on-screen element of the internal product.
    // Text/icon colors are chosen for this dark ground (checked against
    // primary-900/950 for AA); the active item is white text on white/10
    // with a gold marker, same as the Founder Portal's sidebar.
    <aside className="sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col bg-gradient-to-b from-primary-950 via-primary-900 to-primary-950 md:flex lg:w-64">
      <Brand labelled="lg" />
      <NavList {...props} labelled="lg" />
      <ProfileFooter staff={props.staff} onSignOut={props.onSignOut} labelled="lg" />
    </aside>
  );
}

function MobileDrawer({ open, onClose, ...props }: NavProps & { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="md:hidden">
      <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-gradient-to-b from-primary-950 via-primary-900 to-primary-950 shadow-2xl"
      >
        <div className="relative">
          <Brand labelled="always" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-primary-200 hover:bg-white/10 hover:text-white"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <NavList {...props} labelled="always" onNavigate={onClose} />
        <ProfileFooter staff={props.staff} onSignOut={props.onSignOut} labelled="always" onNavigate={onClose} />
      </aside>
    </div>
  );
}
