import { useEffect, useRef, useState } from "react";
import { IconBell } from "./icons/IconBell";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationBellProps {
  notifications: NotificationItem[];
  unreadCount: number;
  loading?: boolean;
  /** Fired when the dropdown is opened — the consumer's chance to refresh. */
  onOpen?: () => void;
  /** Fired when a notification row is clicked (mark-read + navigate is the consumer's job). */
  onSelect: (notification: NotificationItem) => void;
  onMarkAllRead: () => void;
  /** e.g. relative-time formatting — kept out of this package to avoid a date-lib dependency here. */
  formatTimestamp: (iso: string) => string;
}

/**
 * Purely presentational — no fetching, no routing. Session-aware data
 * (what to fetch, where a click navigates) stays in each app's own
 * lib/ hook and app-shell; this package has no Next.js dependency.
 */
export function NotificationBell({
  notifications,
  unreadCount,
  loading = false,
  onOpen,
  onSelect,
  onMarkAllRead,
  formatTimestamp,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onOpen?.();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <IconBell className="h-[19px] w-[19px]" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs font-medium text-primary-700 hover:text-primary-900"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">You&apos;re all caught up.</p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelect(notification);
                  }}
                  className={`flex w-full flex-col gap-0.5 border-b border-slate-50 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50 ${
                    notification.readAt ? "" : "bg-primary-50/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800">{notification.title}</p>
                    {!notification.readAt && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-hidden="true" />
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500">{notification.body}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{formatTimestamp(notification.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
