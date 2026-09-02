// GET/POST /notifications is dual-reachable (see
// apps/backend/src/modules/notifications/notifications.controller.ts) —
// this hook doesn't care whether the caller is a founder or Birr staff
// session, it just calls the session-scoped endpoint. Each app-shell
// decides when `enabled` should be true.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "./api";
import type { NotificationItem } from "@birr/ui";

const POLL_INTERVAL_MS = 60_000;

export function useNotifications(enabled: boolean) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const data = await apiFetchJson<NotificationItem[]>("/notifications").catch(() => null);
    if (data) setNotifications(data);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetchJson<NotificationItem[]>("/notifications")
      .then((data) => {
        if (!cancelled) setNotifications(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, refresh]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    await apiFetchJson(`/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    await apiFetchJson("/notifications/read-all", { method: "POST" }).catch(() => {});
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return { notifications, unreadCount, loading, refresh, markRead, markAllRead };
}

/**
 * Generic fix for the notification read-state gap: a notification's
 * target content could be viewed directly (not through the bell
 * dropdown) without ever marking the underlying Notification.readAt,
 * leaving the unread badge stuck forever. Call this from any page that
 * renders a governed/financial/administrative entity directly — e.g. a
 * distribution detail page passes ("Distribution", distribution.id).
 * Fires once per mount / per id change; best-effort, same "never block
 * the page over this" posture as every other notification write in this
 * codebase.
 */
export function useMarkNotificationsReadForEntity(
  relatedEntityType: string,
  relatedEntityId: string | null | undefined,
) {
  useEffect(() => {
    if (!relatedEntityId) return;
    markNotificationsReadForEntity(relatedEntityType, relatedEntityId);
  }, [relatedEntityType, relatedEntityId]);
}

/** Non-hook counterpart for a list page marking every currently-rendered
 * row's notifications read at once (can't call a hook per array item) —
 * see useMarkNotificationsReadForEntity's own comment for the bug this
 * fixes. Call from a plain useEffect keyed on the list of ids. */
export function markNotificationsReadForEntity(relatedEntityType: string, relatedEntityId: string): void {
  apiFetchJson("/notifications/mark-read-for-entity", {
    method: "POST",
    body: JSON.stringify({ relatedEntityType, relatedEntityId }),
  }).catch(() => {});
}

/**
 * Second variant of the same fix, for a page that shows an aggregate
 * (never an individual entity id) — e.g. the Founder Portal's
 * distribution/contribution summaries, which are deliberately
 * PII-/detail-free rollups (see DistributionsSection's own comment) and
 * so have no per-row id to call markNotificationsReadForEntity with.
 * Same technique the original one-off message.received fix used: fetch
 * the caller's own notification list, filter to the type(s) this page is
 * the destination for AND a matching linkUrl (so viewing one waqf's page
 * never marks a notification pointing at a different waqf's), mark each
 * match read individually. `types`/`linkUrl` are the two things every
 * call site already knows about its own notifications without a lookup.
 */
export function useMarkNotificationsReadByTypeAndLink(types: string[], linkUrl: string | null | undefined) {
  useEffect(() => {
    if (!linkUrl) return;
    let cancelled = false;
    apiFetchJson<NotificationItem[]>("/notifications")
      .then((notifications) => {
        if (cancelled) return;
        const unread = notifications.filter((n) => !n.readAt && types.includes(n.type) && n.linkUrl === linkUrl);
        unread.forEach((n) => {
          apiFetchJson(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkUrl, types.join(",")]);
}
