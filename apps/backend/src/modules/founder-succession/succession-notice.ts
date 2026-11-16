/**
 * The notice a primary contact gets when someone reports they can't act
 * (died, incapacitated, unreachable). It is the one safeguard against a
 * false report, so it must reach them even if they've lost access to
 * their account: besides signing in, it gives Birr's own contact details
 * (Platform Settings → support), and an email reply goes there too.
 *
 * DRAFT (owner's decision, 2026-11-16): Legal must approve this wording.
 * Change OUTGOING_NOTICE_VERSION with any change to the text, so the
 * audit trail shows which wording a contact was sent.
 */
export const OUTGOING_NOTICE_VERSION = "2026-11-16-draft";

export interface BirrContact {
  email?: string | null;
  phone?: string | null;
}

function howToReachBirr(contact: BirrContact): string {
  const ways = [contact.email && `email ${contact.email}`, contact.phone && `call ${contact.phone}`].filter(Boolean);
  if (ways.length === 0) return "contact Birr directly";
  return `${ways.join(" or ")}${contact.email ? " (or reply to this email)" : ""}`;
}

export function outgoingNotice(input: { founderName: string; objectBy: string; contact: BirrContact }) {
  return {
    title: `Request to replace you as primary contact of ${input.founderName}`,
    body:
      `Someone has told Birr you can no longer act as primary contact of ${input.founderName}. ` +
      `If that's wrong, object before ${input.objectBy}: sign in and open Team, or ${howToReachBirr(input.contact)}. ` +
      `Nothing changes while you object.`,
    emailFooter:
      "Please don't ignore this message. If you do nothing, Birr may give your role as primary contact to someone else after the date above. " +
      "If this is wrong, tell Birr.",
  };
}
