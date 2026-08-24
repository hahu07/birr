"use client";

// Client-side nav chrome + session gate. The real enforcement is on the
// backend (SessionAuthGuard, PermissionGuard, StaffRoleGuard — see
// apps/backend/src/common/guards) — every request is checked there
// regardless of what this component does. This redirect is a UX
// convenience only: it keeps a signed-out visitor from seeing a page
// flash before its data fetches start failing with 401s, nothing more.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { BirrStaff, useStaffSession } from "../lib/staff-session";
import { humanize } from "../lib/format";
import {
  IconBriefcase,
  IconClipboardCheck,
  IconFileText,
  IconGlobe,
  IconInbox,
  IconLandmark,
  IconLogOut,
  IconMark,
  IconSettings,
  IconShieldAlert,
  IconSparkle,
  IconUsers,
} from "@birr/ui";

const NAV_ITEMS = [
  { href: "/", label: "Caseload", icon: IconInbox },
  { href: "/governed-actions", label: "Approval Queue", icon: IconClipboardCheck },
  { href: "/foundations", label: "Foundations", icon: IconLandmark },
  { href: "/waqfs", label: "Waqf Funds", icon: IconBriefcase },
  { href: "/conflict-of-interest", label: "Conflicts of Interest", icon: IconShieldAlert },
  { href: "/ai-agents", label: "AI Agents", icon: IconSparkle },
  { href: "/jurisdictions", label: "Jurisdictions", icon: IconGlobe },
  { href: "/staff", label: "Staff", icon: IconUsers },
  { href: "/audit-logs", label: "Audit Log", icon: IconFileText },
  // Backend enforces platform_admin-only via StaffRoleGuard regardless
  // of this filtering — see Sidebar()'s own filter below, which is UX
  // only (no reason to show a nav item that 403s for everyone else).
  { href: "/platform-settings", label: "Platform Settings", icon: IconSettings, requiresRole: "platform_admin" },
];

// Routes reachable with no BirrStaff session — /sign-in (obviously), and
// /accept-invitation (a new invitee has no account yet; the token in the
// URL is their credential, same posture as InvitationsController.accept
// on the backend).
const PUBLIC_ROUTES = ["/sign-in", "/accept-invitation"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { staff, loading, signOut } = useStaffSession();
  // usePathname() never includes the query string, so a plain equality
  // check is enough even for /accept-invitation?token=....
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (!loading && !staff && !isPublicRoute) {
      router.replace("/sign-in");
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
    router.push("/sign-in");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar staff={staff} pathname={pathname} onSignOut={handleSignOut} />
      <div className="min-w-0 flex-1">
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
  onSignOut,
}: {
  staff: BirrStaff;
  pathname: string;
  onSignOut: () => void;
}) {
  return (
    // Collapses to an icon-only rail below `sm` (pure CSS, no added
    // interactive state) rather than the fixed 256px rail overflowing a
    // phone-width viewport — the nav stays reachable, just compact.
    <aside className="flex w-16 shrink-0 flex-col border-r border-slate-200 bg-white sm:w-64">
      <div className="flex items-center justify-center gap-2.5 px-2 py-5 sm:justify-start sm:px-5">
        <IconMark className="h-9 w-9 shrink-0" />
        <div className="hidden sm:block">
          <p className="text-base font-semibold leading-tight tracking-tight text-slate-900">Birr</p>
          <p className="text-[11px] font-medium uppercase leading-tight tracking-wider text-slate-400">
            Ops Console
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-2 sm:px-3">
        {NAV_ITEMS.filter((item) => !item.requiresRole || item.requiresRole === staff.staffRole).map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={item.label}
              className={`flex items-center justify-center gap-2.5 rounded-md px-2 py-2.5 text-sm font-medium transition-colors sm:justify-start sm:px-3 ${
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

      <div className="border-t border-slate-200 p-2 sm:p-3">
        <div className="flex items-center justify-center gap-3 rounded-md px-1 py-2 sm:justify-start sm:px-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-800"
            title={staff.user.fullName}
          >
            {initials(staff.user.fullName)}
          </div>
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="truncate text-sm font-medium text-slate-800">{staff.user.fullName}</p>
            <p className="truncate text-xs text-slate-500">{humanize(staff.staffRole)}</p>
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
