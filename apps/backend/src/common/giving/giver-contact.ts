import type { Prisma } from "@birr/db";

/**
 * How Birr reaches a giver who has no account: an email, a WhatsApp number
 * confirmed by code (GiverWhatsAppService), or both (owner's decision,
 * 2026-11-16). Both also identify the giver for the AML threshold: gifts
 * sharing either one count together.
 */
export interface GiverContact {
  email: string | null;
  whatsapp: string | null;
}

export function hasContact(contact: GiverContact): boolean {
  return Boolean(contact.email || contact.whatsapp);
}

/**
 * Serializes payments by the same giver, so two started together see each
 * other in the threshold check. One lock per contact, taken in sorted
 * order so two payments sharing a number but not an email can't deadlock.
 * The prefix keeps each product's keys apart (Vault uses none, as before).
 */
export async function lockGiverContact(tx: Prisma.TransactionClient, prefix: string, contact: GiverContact): Promise<void> {
  const keys = [contact.email, contact.whatsapp].filter((k): k is string => Boolean(k)).map((k) => prefix + k).sort();
  for (const key of keys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * Paystack needs an email for every customer. A monthly gift with only a
 * WhatsApp number uses a stand-in worked out from the gift's id, the same
 * every month, because Paystack only charges a saved card for the email it
 * was saved under. Never used to send anything.
 */
export function paystackEmailForGift(gift: { id: string; email: string | null }): string {
  return gift.email ?? `giver+${gift.id}@example.com`;
}

const FOOTER = "— *Birr* | A digital trustee for Islamic waqf";

/** "₦95,000.00", or "USD 250.00" for another currency: amounts in WhatsApp messages. */
export function moneyText(amount: { toString(): string } | number, currency = "NGN"): string {
  const value = Number(amount.toString()).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "NGN" ? `₦${value}` : `${currency} ${value}`;
}

/** A WhatsApp message in Birr's one layout: the title in bold, the lines, the footer. */
export function whatsAppNotice(title: string, lines: string[]): string {
  return [`*${title}*`, "", ...lines, "", FOOTER].join("\n");
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/**
 * An HTML email's message as WhatsApp text: the heading in bold, the
 * paragraphs and list items as plain lines, and the button as a link.
 */
export function whatsAppTextFromEmail(message: { heading: string; bodyHtml: string; ctaLabel?: string; ctaUrl?: string }): string {
  const body = message.bodyHtml
    .replace(/<li>/gi, "• ")
    .replace(/<\/(p|li|ul)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2: $1")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return whatsAppNotice(message.heading, message.ctaUrl ? [body, "", `👉 ${message.ctaLabel ?? "Open in Birr"}: ${message.ctaUrl}`] : [body]);
}
