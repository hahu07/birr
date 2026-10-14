"use client";

// Messages inbox — one row per Foundation conversation, most recent
// first; each opens that Foundation's own page, where the thread itself
// lives (see foundations/[id]/MessagesSection.tsx). Unread state comes
// from message.received notifications, the same source the bell uses.
// The Ops Console's app/ops/messages/page.tsx is the mirrored
// counterpart — same shape, different link destination.
//
// 2026-10 redesign: with no conversations yet, the empty state now lists
// the Founder's Foundations with a direct "Start a conversation" link
// each, rather than only telling them a conversation starts "from your
// Foundation's own page".
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatRelativeTime } from "../../../lib/format";
import { useFounderSession } from "../../../lib/founder-session";
import { useNotifications } from "../../../lib/notifications";
import type { Foundation, MessagesInboxRow } from "../../../lib/types";
import { Alert, IconChevronRight, IconMessageCircle, Skeleton } from "@birr/ui";
import { PageHeader, Panel, PanelHeader } from "../_components/ui";

export default function FounderMessagesInboxPage() {
  const { user } = useFounderSession();
  const [inbox, setInbox] = useState<MessagesInboxRow[] | null>(null);
  const [foundations, setFoundations] = useState<Foundation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { notifications } = useNotifications(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetchJson<MessagesInboxRow[]>("/messages/inbox"), apiFetchJson<Foundation[]>("/foundations")])
      .then(([inboxData, foundationsData]) => {
        if (cancelled) return;
        setInbox(inboxData);
        setFoundations(foundationsData);
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
  const withoutConversation = (foundations ?? []).filter((f) => !inbox?.some((row) => row.foundation.id === f.id));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Messages"
        title="Conversations with Birr"
        description="Direct, private conversations with Birr's team — one per Foundation."
      />

      {error && (
        <Alert tone="danger" title="Couldn't load messages" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && inbox === null && <Skeleton className="h-48 w-full rounded-2xl" />}

      {!error && inbox !== null && inbox.length > 0 && (
        <Panel className="mb-6">
          <PanelHeader
            title="Inbox"
            aside={unreadFoundationIds.size > 0 && <span className="text-xs font-semibold text-primary-700">{unreadFoundationIds.size} unread</span>}
          />
          <ul className="divide-y divide-slate-100">
            {inbox.map((row) => {
              const unread = unreadFoundationIds.has(row.foundation.id);
              const fromMe = row.lastMessage.senderUser.id === user?.id;
              return (
                <li key={row.foundation.id}>
                  <Link
                    href={`/foundations/${row.foundation.id}`}
                    className={`group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-50/80 ${unread ? "bg-primary-50/40" : ""}`}
                  >
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-900 text-sm font-semibold text-accent-300">
                      {row.foundation.name.trim().charAt(0).toUpperCase()}
                      {unread && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-accent-500" aria-label="Unread" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>
                          {row.foundation.name}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">{formatRelativeTime(row.lastMessage.createdAt)}</span>
                      </span>
                      <span className={`mt-0.5 block truncate text-sm ${unread ? "text-slate-700" : "text-slate-500"}`}>
                        <span className="font-medium">{fromMe ? "You" : row.lastMessage.senderUser.fullName}:</span>{" "}
                        {row.lastMessage.body || "(attachment)"}
                      </span>
                    </span>
                    <IconChevronRight className="mt-3 h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {!error && inbox !== null && foundations !== null && withoutConversation.length > 0 && (
        <Panel>
          <PanelHeader title={inbox.length === 0 ? "Start a conversation" : "Message about another Foundation"} />
          {inbox.length === 0 && (
            <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconMessageCircle className="h-[18px] w-[18px]" />
              </span>
              <p className="text-sm leading-relaxed text-slate-600">
                No conversations yet. Questions about a fund, a cause, or a document? Pick the Foundation it's about —
                Birr's team replies here, and you'll get a notification.
              </p>
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {withoutConversation.map((f) => (
              <li key={f.id}>
                <Link href={`/foundations/${f.id}`} className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50/80">
                  <span className="truncate text-sm font-medium text-slate-800">{f.name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-700">
                    Start a conversation
                    <IconChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
