"use client";

// Founder-side wrapper around the shared, symmetric MessageThread
// component (packages/ui) — any active member of a Founder attached to
// this Foundation can view and send (not just the primary contact;
// messaging isn't an org-commitment action like establishing a
// Foundation or signing a deed). This file exists only because it
// imports from this route group's own lib/api.ts/types.ts — the UI
// itself (packages/ui's MessageThread) is byte-for-byte the same
// component the Ops-side wrapper renders.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatRelativeTime } from "../../../../lib/format";
import type { Message } from "../../../../lib/types";
import { Alert, MessageThread, Skeleton, type NotificationItem } from "@birr/ui";

const POLL_INTERVAL_MS = 30_000;

export function MessagesSection({ foundationId }: { foundationId: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Opening this Foundation's own thread is the real "I've seen this"
  // signal — without this, a message read here (rather than via the
  // bell dropdown's own onSelect) never marks its notification read, so
  // the sidebar's unread badge would never clear. Runs once per mount,
  // not on every 30s poll.
  const markedReadRef = useRef(false);

  const load = useCallback(() => {
    apiFetchJson<Message[]>(`/messages?foundationId=${foundationId}`)
      .then(setMessages)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [foundationId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (markedReadRef.current) return;
    markedReadRef.current = true;
    apiFetchJson<NotificationItem[]>("/notifications")
      .then((notifications) => {
        const unread = notifications.filter(
          (n) => n.type === "message.received" && !n.readAt && n.linkUrl === `/foundations/${foundationId}`,
        );
        return Promise.all(unread.map((n) => apiFetchJson(`/notifications/${n.id}/read`, { method: "POST" })));
      })
      .catch(() => {});
  }, [foundationId]);

  async function handleSend(body: string, files: File[]) {
    setSending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("foundationId", foundationId);
      formData.set("body", body);
      for (const file of files) formData.append("attachments", file);
      await apiFetchJson("/messages", { method: "POST", body: formData });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-8 border-t border-slate-100 pt-8">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Messages</p>
      <p className="mb-3 text-sm text-slate-500">Direct communication with Birr about this Foundation.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load messages" className="mb-4">
          {error}
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
          currentSenderType="founder_user"
          onSend={handleSend}
          sending={sending}
          formatTimestamp={formatRelativeTime}
        />
      )}
    </div>
  );
}
