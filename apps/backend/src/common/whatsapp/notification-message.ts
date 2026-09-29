// Per-type WhatsApp message templates. Redesigned 2026-09-29 to match
// the structure of a well-formed WhatsApp Business notification (bold
// headline behind a status icon, a short body, an explicit call-to-
// action line, and — only when there's a link to click — a one-line
// branded signature underneath it). *text* and blank-line paragraph
// breaks are WhatsApp's own lightweight markdown, not HTML; Twilio's
// messages.create sends this as plain text (see TwilioWhatsAppAdapter
// .sendMessage) and the WhatsApp client renders the formatting itself.
//
// The branded signature line matters specifically because a message
// asking someone to tap a link is exactly the shape a phishing message
// takes — a verifiable brand name plus a real, matching domain right
// next to the link is a genuine anti-impersonation signal, not just
// decoration. It's included only on messages that carry a link, not on
// every short receipt — signing a bare "confirmed" message with nothing
// to click adds noise without adding trust.
//
// WhatsApp is reserved for the small number of notification types that
// need someone to actually act, not just be informed — see
// NotificationsService's CHANNEL_PLAN — so this stays terse by design,
// not a full branded email.

export interface WhatsAppMessageInput {
  type: string;
  title: string;
  body: string;
  /** Must already be an absolute URL — see resolvePortalLink. A bare in-app path isn't a valid link outside the app's own router. */
  linkUrl?: string;
}

// A status icon per notification type, not decoration — it's what lets
// someone scanning a notification list on their phone tell a routine
// confirmation apart from something that actually needs their attention
// without opening it. Absent from this map falls back to a generic bell,
// same "unmapped = safe default" convention CHANNEL_PLAN itself uses.
const TYPE_ICON: Record<string, string> = {
  "governed_action.proposed": "🔔", // needs a checker
  "distribution.paid": "💰",
  "contribution.confirmed": "✅",
  "contribution.failed": "⚠️",
  "waqf.activated": "🟢",
  "founder_membership.joined": "👥",
  "foundation.co_founder_joined": "👥",
  "foundation_deed.signed": "📝",
  "coi.escalated": "🚨",
  "trustee_license.expiring": "⏰",
};
const DEFAULT_ICON = "🔔";

export function renderWhatsAppMessage({ type, title, body, linkUrl }: WhatsAppMessageInput): string {
  const icon = TYPE_ICON[type] ?? DEFAULT_ICON;
  const lines = [`${icon} *${title}*`, "", body];
  // "View in Birr" — the exact label ResendNotificationEmailAdapter
  // already uses for this same action, kept identical rather than
  // inventing separate WhatsApp-only copy for the same button.
  if (linkUrl) {
    lines.push("", "👉 View in Birr:", linkUrl, "", "— *Birr* | A digital trustee for Islamic waqf");
  }
  return lines.join("\n");
}
