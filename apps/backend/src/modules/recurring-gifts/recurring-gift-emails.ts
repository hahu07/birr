import type { RecurringGift } from "@birr/db";
import type { RecurringGiftEmail } from "./email/resend-recurring-gift-email.adapter";

/** "₦25,000" or "₦25,000.50". */
export function formatNaira(amount: { toString(): string } | string): string {
  const value = Number(amount.toString());
  return `₦${value.toLocaleString("en-NG", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(date);
}

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

/** What the gift goes to, for a sentence: "the Ramadan Relief Vault", "Yusra Fund", "your zakah". */
export interface GiftTarget {
  /** e.g. "to Ramadan Relief" or "towards your zakah". */
  phrase: string;
}

/** Where a gift's messages go: its email and/or WhatsApp number, and a founder's own number for a top-up. */
function recipients(gift: RecurringGift) {
  return { to: gift.email, whatsappTo: gift.whatsappNumber, founderAccountEmail: gift.kind === "waqf" ? gift.email : null };
}

function card(gift: RecurringGift): string {
  return gift.cardLast4 ? `the card ending ${gift.cardLast4}` : "your saved card";
}

const KEEP_LINK =
  "<p>Keep this message: the link below is your private link to change the amount, update your card or cancel, any time. Anyone with the link can manage this gift.</p>";

export function setUpEmail(gift: RecurringGift, target: GiftTarget, manageUrl: string): RecurringGiftEmail {
  const zakah = gift.kind === "zakah";
  return {
    ...recipients(gift),
    subject: zakah ? "Your monthly zakah is set up" : "Your monthly gift is set up",
    heading: zakah ? "Monthly zakah set up" : "Monthly gift set up",
    bodyHtml:
      `<p>Thank you. ${formatNaira(gift.amount)} ${target.phrase} will be charged to ${card(gift)} on the ${ordinal(gift.dayOfMonth)} of every month` +
      (gift.nextChargeAt ? `, starting ${formatDay(gift.nextChargeAt)}` : "") +
      `. We'll remind you a few days before each charge.</p>` +
      (zakah ? "<p>Each payment is zakah paid in advance towards your annual zakah.</p>" : "") +
      (gift.kind === "waqf" ? "" : KEEP_LINK),
    ctaLabel: gift.kind === "waqf" ? "View your Waqf Fund" : "Manage your monthly gift",
    ctaUrl: manageUrl,
  };
}

export function reminderEmail(gift: RecurringGift, target: GiftTarget, manageUrl: string): RecurringGiftEmail {
  return {
    ...recipients(gift),
    subject: `${formatNaira(gift.amount)} will be charged on ${gift.nextChargeAt ? formatDay(gift.nextChargeAt) : "your next date"}`,
    heading: "Your next monthly gift",
    bodyHtml: `<p>On ${gift.nextChargeAt ? formatDay(gift.nextChargeAt) : "your next date"} we'll charge ${formatNaira(gift.amount)} ${target.phrase} to ${card(gift)}.</p><p>Nothing to do if that's fine. To change the amount or stop, use the button below before then.</p>`,
    ctaLabel: "Manage your monthly gift",
    ctaUrl: manageUrl,
  };
}

export function chargeFailedEmail(gift: RecurringGift, target: GiftTarget, manageUrl: string, retryAt: Date | null): RecurringGiftEmail {
  return {
    ...recipients(gift),
    subject: "Your monthly gift didn't go through",
    heading: "Payment didn't go through",
    bodyHtml:
      `<p>We couldn't charge ${formatNaira(gift.amount)} ${target.phrase} to ${card(gift)}.</p>` +
      (retryAt
        ? `<p>We'll try again on ${formatDay(retryAt)}. If your card has changed, you can update it now.</p>`
        : `<p>We've tried three times, so your monthly gift is paused. Update your card to start it again.</p>`),
    ctaLabel: "Update your card",
    ctaUrl: manageUrl,
  };
}

export function pausedEmail(gift: RecurringGift, target: GiftTarget, manageUrl: string): RecurringGiftEmail {
  const why: Record<string, string> = {
    card_expired: `${card(gift).replace(/^the/, "The")} has expired. Add a new card to carry on.`,
    needs_identity:
      "Your giving has reached the level where the law requires us to record your full name and ID. Add them to carry on.",
    terms_changed: "The terms for paying zakah through Birr have changed. Please read and accept them to carry on.",
    below_minimum: `The minimum gift has gone up above ${formatNaira(gift.amount)}. Raise your monthly amount to carry on.`,
  };
  return {
    ...recipients(gift),
    subject: "Your monthly gift is paused",
    heading: "Monthly gift paused",
    bodyHtml: `<p>We haven't charged your monthly gift ${target.phrase}. ${why[gift.pauseReason ?? ""] ?? ""}</p>`,
    ctaLabel: gift.kind === "waqf" ? "View your Waqf Fund" : "Manage your monthly gift",
    ctaUrl: manageUrl,
  };
}

export function endedEmail(gift: RecurringGift, target: GiftTarget, reason: string): RecurringGiftEmail {
  return {
    ...recipients(gift),
    subject: "Your monthly gift has ended",
    heading: "Monthly gift ended",
    bodyHtml: `<p>Your monthly gift of ${formatNaira(gift.amount)} ${target.phrase} has ended${reason ? `: ${reason}` : ""}. No further payments will be taken.</p>`,
  };
}

export function cancelledEmail(gift: RecurringGift, target: GiftTarget): RecurringGiftEmail {
  return {
    ...recipients(gift),
    subject: "Your monthly gift is cancelled",
    heading: "Monthly gift cancelled",
    bodyHtml: `<p>Your monthly gift of ${formatNaira(gift.amount)} ${target.phrase} is cancelled. No further payments will be taken. Thank you for everything you've given.</p>`,
  };
}

export function manageLinksEmail(contact: { email: string | null; whatsapp: string | null }, links: { label: string; url: string }[]): RecurringGiftEmail {
  return {
    to: contact.email,
    whatsappTo: contact.whatsapp,
    subject: "Your monthly gift links",
    heading: "Manage your monthly giving",
    bodyHtml:
      `<p>Here ${links.length === 1 ? "is the private link" : "are the private links"} to your monthly giving. Earlier links no longer work.</p><ul>` +
      links.map((l) => `<li><a href="${l.url}">${l.label}</a></li>`).join("") +
      "</ul>",
  };
}
