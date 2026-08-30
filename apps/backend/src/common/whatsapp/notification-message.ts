// Short, per-type WhatsApp message templates — deliberately terse and
// plain-text (no HTML, no branding chrome). WhatsApp is reserved for the
// small number of notification types that need someone to actually act,
// not just be informed (see NotificationsService's CHANNEL_PLAN) — a
// long, decorated message would work against that.

export interface WhatsAppMessageInput {
  type: string;
  title: string;
  body: string;
  linkUrl?: string;
}

export function renderWhatsAppMessage({ title, body, linkUrl }: WhatsAppMessageInput): string {
  const link = linkUrl ? `\n${linkUrl}` : "";
  return `Birr: ${title}\n${body}${link}`;
}
