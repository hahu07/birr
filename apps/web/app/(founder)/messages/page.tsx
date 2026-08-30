"use client";

// Messages inbox — every Foundation this founder is attached to that
// has at least one message, most recently active first. For a founder
// with just one Foundation this is a one-row list (still useful — same
// unread/at-a-glance value as the Ops side's own inbox); for a founder
// who co-founded more than one, it's the only place to see all of them
// without visiting each Foundation's own page in turn. See the Ops
// Console's app/ops/messages/page.tsx for the mirrored counterpart —
// same shape, different link destination and lib/ imports.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatRelativeTime } from "../../../lib/format";
import { useNotifications } from "../../../lib/notifications";
import type { MessagesInboxRow } from "../../../lib/types";
import { Alert, EmptyState, IconInbox, Skeleton } from "@birr/ui";

export default function FounderMessagesInboxPage() {
  const [inbox, setInbox] = useState<MessagesInboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          <p className="mt-0.5 text-sm text-slate-500">Your conversations with Birr, most recent first.</p>
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
        </div>
      )}

      {!error && inbox !== null && inbox.length === 0 && (
        <EmptyState
          title="No messages yet"
          description="Start a conversation from your Foundation's own page — it will show up here."
        />
      )}

      {!error && inbox !== null && inbox.length > 0 && (
        <div className="space-y-1.5">
          {inbox.map((row) => {
            const unread = unreadFoundationIds.has(row.foundation.id);
            return (
              <Link
                key={row.foundation.id}
                href={`/foundations/${row.foundation.id}`}
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
