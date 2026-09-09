import { useRef, useState } from "react";
import { IconFileText } from "./icons/IconFileText";
import { Button } from "./Button";

export interface MessageThreadAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface MessageThreadItem {
  id: string;
  senderType: "birr_staff" | "founder_user";
  senderUser: { id: string; fullName: string };
  body: string;
  createdAt: string;
  attachments: MessageThreadAttachment[];
}

export interface MessageThreadProps {
  messages: MessageThreadItem[];
  /** Whose dashboard this is rendering in — decides which side each bubble sits on. */
  currentSenderType: "birr_staff" | "founder_user";
  onSend: (body: string, files: File[]) => Promise<void>;
  sending: boolean;
  /** Kept out of this package to avoid a date-lib dependency here — same convention as NotificationBell. */
  formatTimestamp: (iso: string) => string;
}

/**
 * Purely presentational, no fetching — symmetric by design: unlike
 * every other Waqf-Fund-page section pair in this codebase (Assets,
 * Beneficiaries, ...), a Founder and Birr staff see and can do exactly
 * the same thing here, so one shared component backs both dashboards'
 * thin wrapper files instead of a read-only founder variant.
 */
export function MessageThread({ messages, currentSenderType, onSend, sending, formatTimestamp }: MessageThreadProps) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && files.length === 0) return;
    await onSend(body.trim(), files);
    setBody("");
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col">
      <div className="mb-3 max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
        {messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
        {messages.map((m) => {
          const isOwn = m.senderType === currentSenderType;
          return (
            <div key={m.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm shadow-sm ${
                  isOwn ? "bg-primary-600 text-white" : "border border-slate-200 bg-white text-slate-900"
                }`}
              >
                <div className={`mb-0.5 flex items-baseline gap-2 text-xs ${isOwn ? "text-primary-100" : "text-slate-500"}`}>
                  <span className="font-medium">{m.senderUser.fullName}</span>
                  <span>{formatTimestamp(m.createdAt)}</span>
                </div>
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                {m.attachments.length > 0 && (
                  <div className={`${m.body ? "mt-2" : ""} space-y-1`}>
                    {m.attachments.map((a) => (
                      <a
                        key={a.id}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs underline ${
                          isOwn ? "bg-primary-700/50 text-white hover:bg-primary-700" : "bg-slate-100 text-primary-700 hover:bg-slate-200"
                        }`}
                      >
                        <IconFileText className="h-3.5 w-3.5 shrink-0" />
                        {a.fileName}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
              >
                {f.name}
                <button
                  type="button"
                  className="text-slate-500 hover:text-slate-700"
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
          />
          <Button type="button" variant="secondary" className="px-3 py-2 text-xs" onClick={() => fileInputRef.current?.click()}>
            Attach
          </Button>
          <Button type="submit" disabled={sending || (!body.trim() && files.length === 0)} className="px-4 py-2 text-sm">
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
