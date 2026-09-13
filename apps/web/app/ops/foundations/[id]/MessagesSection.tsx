"use client";

// Ops-side wrapper around the shared, symmetric MessageThread component
// (packages/ui) — any active Birr staff member can view and reply, no
// case-assignment restriction (confirmed with the owner). This file
// exists only because it imports from this route group's own
// lib/api.ts/ops-types.ts — the UI itself (packages/ui's MessageThread)
// is byte-for-byte the same component the Founder-side wrapper renders.
import { useEffect, useRef, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatRelativeTime } from "../../../../lib/format";
import type { Message } from "../../../../lib/ops-types";
import { Alert, MessageThread, Skeleton, type NotificationItem } from "@birr/ui";
import { useLoadedResource } from "../../_components/SectionChrome";

const POLL_INTERVAL_MS = 30_000;

export function MessagesSection({ foundationId }: { foundationId: string }) {
  const {
    data: messages,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<Message[]>(`/messages?foundationId=${foundationId}`), [foundationId]);
  const [sending, setSending] = useState(false);
  // Separate from the hook's own load-failure `error` — a send failure
  // used to overwrite that same variable (pre-existing behavior kept:
  // both still render under the one "Couldn't load messages" Alert
  // below, whichever is set).
  const [sendError, setSendError] = useState<string | null>(null);
  // Opening this Foundation's own thread is the real "I've seen this"
  // signal — without this, a message read here (rather than via the
  // bell dropdown's own onSelect) never marks its notification read, so
  // the sidebar's unread badge would never clear. Runs once per mount,
  // not on every 30s poll.
  const markedReadRef = useRef(false);

  // The hook's own effect already fires the initial load on mount/
  // foundationId change — this just layers the recurring poll on top.
  useEffect(() => {
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (markedReadRef.current) return;
    markedReadRef.current = true;
    apiFetchJson<NotificationItem[]>("/notifications")
      .then((notifications) => {
        const unread = notifications.filter(
          (n) => n.type === "message.received" && !n.readAt && n.linkUrl === `/ops/foundations/${foundationId}`,
        );
        return Promise.all(unread.map((n) => apiFetchJson(`/notifications/${n.id}/read`, { method: "POST" })));
      })
      .catch(() => {});
  }, [foundationId]);

  async function handleSend(body: string, files: File[]) {
    setSending(true);
    setSendError(null);
    try {
      const formData = new FormData();
      formData.set("foundationId", foundationId);
      formData.set("body", body);
      for (const file of files) formData.append("attachments", file);
      await apiFetchJson("/messages", { method: "POST", body: formData });
      load();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Messages</p>
      <p className="mb-3 text-sm text-slate-500">Direct communication with this Foundation's Founder team.</p>

      {(error || sendError) && (
        <Alert tone="danger" title="Couldn't load messages" className="mb-4">
          {error ?? sendError}
        </Alert>
      )}

      {messages === null && !error && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {messages !== null && (
        <MessageThread
          messages={messages}
          currentSenderType="birr_staff"
          onSend={handleSend}
          sending={sending}
          formatTimestamp={formatRelativeTime}
        />
      )}
    </section>
  );
}
