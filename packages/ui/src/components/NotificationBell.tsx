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
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggleButtonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    // Moves focus into the panel the moment it opens — without this, a
    // keyboard user who just activated the toggle button has no
    // indication focus is still sitting on a now-hidden-behind-the-panel
    // control.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onOpen?.();
  }

  return (
    <div ref={containerRef} className="group relative">
      <button
        ref={toggleButtonRef}
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b from-primary-600 to-primary-700 text-white shadow-md shadow-primary-900/25 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        <IconBell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Hover/focus label — same "floating action button + tooltip"
          language as a chat-widget bubble, applied to Birr's own primary
          color rather than borrowing WhatsApp's green, so it reads as
          this product's own chrome, not a lookalike of the real WhatsApp
          integration elsewhere in the app (OTP verification). CSS-only:
          no JS state, hidden from screen readers since the button's own
          aria-label already carries this information. */}
      {!open && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-md transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
        >
          {unreadCount > 0 ? `${unreadCount > 9 ? "9+" : unreadCount} unread` : "Notifications"}
        </span>
      )}

      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          className="absolute right-0 z-20 mt-3 w-80 origin-top-right rounded-lg border border-slate-200 bg-white shadow-lg outline-none sm:w-96"
        >
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
