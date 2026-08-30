"use client";

// Messages inbox — every Foundation with at least one message, most
// recently active first. Unlike a single Foundation's own Messages
// section (app/ops/foundations/[id]/MessagesSection.tsx), this is the
// discoverability fix: staff manage many Foundations at once, so
// finding "who's messaged us" without already knowing which Foundation
// to check was a real gap. No separate read-tracking here — "unread"
// is derived from the same message.received Notification rows the bell
// already polls (see useNotifications), not a second source of truth.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatRelativeTime } from "../../../lib/format";
import { useNotifications } from "../../../lib/notifications";
import type { MessagesInboxRow } from "../../../lib/ops-types";
import { Alert, EmptyState, IconInbox, Skeleton } from "@birr/ui";

export default function OpsMessagesInboxPage() {
  const [inbox, setInbox] = useState<MessagesInboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A second poll, independent of AppShell's own — this page needs the
  // per-Foundation unread breakdown, not just the header bell's total
  // count, and there's no shared context to thread it through instead.
  const { notifications } = useNotifications(true);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<MessagesInboxRow[]>("/messages/inbox")
      .then((data) => {
        if (!cancelled) setInbox(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unreadFoundationIds = new Set(
    notifications
      .filter((n) => n.type === "message.received" && !n.readAt)
      .map((n) => n.linkUrl?.split("/").pop())
      .filter((id): id is string => Boolean(id)),
  );

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconInbox className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Messages</h1>
          <p className="mt-0.5 text-sm text-slate-500">Every Foundation with a conversation, most recent first.</p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load messages" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && inbox === null && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!error && inbox !== null && inbox.length === 0 && (
        <EmptyState
          title="No messages yet"
          description="Conversations with a Founder's team will appear here once one starts."
        />
      )}

      {!error && inbox !== null && inbox.length > 0 && (
        <div className="space-y-1.5">
          {inbox.map((row) => {
            const unread = unreadFoundationIds.has(row.foundation.id);
            return (
              <Link
                key={row.foundation.id}
                href={`/ops/foundations/${row.foundation.id}`}
                className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600" />}
                  <div className="min-w-0">
                    <p className={`text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                      {row.foundation.name}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      <span className="font-medium text-slate-600">{row.lastMessage.senderUser.fullName}:</span>{" "}
                      {row.lastMessage.body || "(attachment)"}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                  {formatRelativeTime(row.lastMessage.createdAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
