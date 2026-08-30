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
