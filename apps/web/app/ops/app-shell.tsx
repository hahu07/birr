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
import { humanize, formatRelativeTime } from "../../lib/format";
import { useNotifications } from "../../lib/notifications";
import type { WaqfCaseAssignment } from "../../lib/ops-types";
import {
  IconBriefcase,
  IconClipboardCheck,
  IconFileText,
  IconGlobe,
  IconHome,
  IconInbox,
  IconKey,
  IconLandmark,
  IconLogOut,
  IconMark,
  IconMessageCircle,
  IconSettings,
  IconShieldAlert,
  IconSparkle,
  IconUsers,
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
  items: { href: string; label: string; icon: typeof IconInbox; requiresRole?: string; requiresCaseload?: boolean }[];
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
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/ops/governed-actions", label: "Approvals", icon: IconClipboardCheck },
      { href: "/ops/conflict-of-interest", label: "Conflicts of Interest", icon: IconShieldAlert },
      { href: "/ops/ai-agents", label: "AI Agents", icon: IconSparkle },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { href: "/ops/foundations", label: "Foundations", icon: IconLandmark },
      { href: "/ops/waqfs", label: "Waqf Funds", icon: IconBriefcase },
      { href: "/ops/counterparties", label: "Counterparties", icon: IconLandmark },
      { href: "/ops/cause-categories", label: "Cause Categories", icon: IconSparkle },
    ],
  },
  {
    label: "Compliance",
    items: [
      { href: "/ops/jurisdictions", label: "Jurisdictions", icon: IconGlobe },
      { href: "/ops/audit-logs", label: "Audit Log", icon: IconFileText },
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
      { href: "/ops/platform-settings", label: "Settings", icon: IconSettings, requiresRole: "platform_admin" },
      { href: "/ops/waqf-funding", label: "Waqf Funding", icon: IconSettings, requiresRole: "platform_admin" },
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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { staff, loading, signOut } = useStaffSession();
  // usePathname() never includes the query string, so a plain equality
  // check is enough even for /accept-invitation?token=....
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
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

  useEffect(() => {
    if (!loading && !staff && !isPublicRoute) {
      router.replace(SIGN_IN_ROUTE);
    }
  }, [loading, staff, isPublicRoute, router]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (loading || !staff) {
    // Either still resolving the stored staff id, or about to be
    // redirected to /sign-in by the effect above — render nothing
    // conspicuous either way.
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  function handleSignOut() {
    signOut();
    router.push(SIGN_IN_ROUTE);
  }

  function handleSelectNotification(notification: NotificationItem) {
    markRead(notification.id);
    if (notification.linkUrl) router.push(notification.linkUrl);
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        staff={staff}
        pathname={pathname}
        hasCaseload={hasCaseload}
        unreadMessageCount={notifications.filter((n) => n.type === "message.received" && !n.readAt).length}
        onSignOut={handleSignOut}
      />
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-end border-b border-slate-200 bg-white px-4 py-2.5 sm:px-8">
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
        <main className="px-4 py-8 sm:px-8 sm:py-10">
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
  staff,
  pathname,
  hasCaseload,
  unreadMessageCount,
  onSignOut,
}: {
  staff: BirrStaff;
  pathname: string;
  hasCaseload: boolean;
  unreadMessageCount: number;
  onSignOut: () => void;
}) {
  return (
    // Collapses to an icon-only rail below `sm` (pure CSS, no added
    // interactive state) rather than the fixed 256px rail overflowing a
    // phone-width viewport — the nav stays reachable, just compact.
    //
    // A deep, deliberately colorful rail (primary-950 → primary-900,
    // gold-tinted at the very top) rather than a flat white one — this is
    // the single most-visible, always-on-screen element of the internal
    // product, so it's the highest-leverage place to make the palette
    // register immediately. Text/icon colors below are chosen for this
    // dark ground specifically (not the light-mode slate scale used
    // elsewhere), each checked against primary-900/950 for AA.
    <aside className="flex w-16 shrink-0 flex-col bg-gradient-to-b from-primary-950 via-primary-900 to-primary-900 sm:w-64">
      <div className="flex items-center justify-center gap-2.5 border-b border-white/10 bg-gradient-to-br from-accent-900/40 to-transparent px-2 py-5 sm:justify-start sm:px-5">
        <IconMark className="h-9 w-9 shrink-0" />
        <div className="hidden sm:block">
          <p className="text-base font-semibold leading-tight tracking-tight text-white">Birr</p>
          <p className="text-[11px] font-semibold leading-tight uppercase tracking-wider text-accent-400">
            Ops Console
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4 sm:px-3">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(
            (item) =>
              (!item.requiresRole || item.requiresRole === staff.staffRole) &&
              (!item.requiresCaseload || hasCaseload),
          );
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="hidden px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-300 sm:block">
                {group.label}
              </p>
              <div className="space-y-1">
                {items.map((item) => {
                  const isActive = item.href === HOME_ROUTE ? pathname === HOME_ROUTE : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      title={item.label}
                      className={`flex items-center justify-center gap-2.5 rounded-md px-2 py-2.5 text-sm font-medium transition-colors sm:justify-start sm:px-3 ${
                        isActive
                          ? // primary-500→600 measured at 4.26:1 for white text at the
                            // gradient's lighter (left) end — below the 4.5:1 AA floor,
                            // and exactly where the icon and first letters sit. One step
                            // darker clears AA across the whole pill (5.7:1 → 7.2:1)
                            // while staying visibly brighter than the primary-900 rail.
                            "bg-gradient-to-r from-primary-600 to-primary-700 text-white shadow-sm shadow-primary-950/50"
                          : "text-primary-200 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-white" : "text-primary-300"}`}
                      />
                      <span className="hidden sm:inline">{item.label}</span>
                      {item.href === "/ops/messages" && unreadMessageCount > 0 && (
                        <span className="ml-auto hidden h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white sm:flex">
                          {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-2 sm:p-3">
        <Link
          href="/ops/profile"
          title="My Profile"
          className="flex items-center justify-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-white/10 sm:justify-start sm:px-2"
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-300 to-accent-500 text-xs font-semibold text-primary-950"
            title={staff.user.fullName}
          >
            {initials(staff.user.fullName)}
          </div>
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="truncate text-sm font-medium text-white">{staff.user.fullName}</p>
            <p className="truncate text-xs text-primary-300">{humanize(staff.staffRole)}</p>
          </div>
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-primary-300 transition-colors hover:bg-white/10 hover:text-white sm:flex"
        >
          <IconLogOut className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-md text-primary-300 transition-colors hover:bg-white/10 hover:text-white sm:hidden"
        >
          <IconLogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </aside>
  );
}
