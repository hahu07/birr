/**
 * The statement a co-founder accepts when joining a Foundation, so their
 * own money is dedicated with their own recorded agreement rather than on
 * another founder's signature alone (owner's decision, 2026-11-14 — "A2"
 * in the Board note "Joint Waqf: Who Signs the Deed"). Which one they see
 * depends on whether the Foundation's deed is signed yet.
 *
 * This wording went live at the owner's direction before Legal or the
 * Shariah Supervisory Board reviewed it. Changing it means a new
 * `version`: each CoFounderDeedConsent stores the version and the exact
 * text its co-founder accepted, and the server refuses an acceptance
 * that agreed to anything other than the current version.
 */
import { createHash } from "crypto";
import type { CoFounderConsentKind, Prisma } from "@birr/db";

export const CO_FOUNDER_STATEMENT_VERSION = "2026-11-14-v1";

export interface CoFounderStatementContext {
  foundationName: string;
  /** Set once the deed is signed. */
  signedDeed: { signerName: string; signedAt: Date } | null;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(date);
}

export function coFounderStatementKind(ctx: CoFounderStatementContext): CoFounderConsentKind {
  return ctx.signedDeed ? "adopt_signed_deed" : "authorize_signer";
}

export function renderCoFounderStatement(ctx: CoFounderStatementContext): string {
  const name = ctx.foundationName;
  if (ctx.signedDeed) {
    return (
      `I join ${name} as a co-founder. I adopt its Deed of Waqf, signed by ${ctx.signedDeed.signerName} on ` +
      `${formatDate(ctx.signedDeed.signedAt)}, as if I had signed it myself, and I dedicate my own contributions to any ` +
      `Waqf Fund under ${name} as waqf on its terms. Once dedicated, my contributions cannot be reclaimed.`
    );
  }
  return (
    `I join ${name} as a co-founder. I authorize the founder who signs its Deed of Waqf to sign it for me as well as ` +
    `for themselves. From then on the Deed applies to me, and I dedicate my own contributions to any Waqf Fund under ` +
    `${name} as waqf on its terms. Once dedicated, my contributions cannot be reclaimed.`
  );
}

/** What a statement is rendered from: the Foundation's name and its deed, if signed. */
export const FOUNDATION_FOR_STATEMENT = {
  select: {
    name: true,
    establishedJointly: true,
    foundationDeed: { select: { id: true, signedAt: true, signedByUser: { select: { fullName: true } } } },
  },
} as const;

export function coFounderStatementContext(foundation: {
  name: string;
  foundationDeed: { signedAt: Date; signedByUser: { fullName: string } } | null;
}): CoFounderStatementContext {
  return {
    foundationName: foundation.name,
    signedDeed: foundation.foundationDeed
      ? { signerName: foundation.foundationDeed.signedByUser.fullName, signedAt: foundation.foundationDeed.signedAt }
      : null,
  };
}

/**
 * The hash a co-founder's client echoes back when accepting: proof they
 * saw exactly the statement being stored. The version alone isn't enough,
 * since both statements share it, and the deed can be signed while
 * they're reading the "authorize the signer" one.
 */
export function hashStatement(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Takes the Foundation's row lock for the rest of the transaction. Signing
 * the deed and recording a co-founder's agreement both take it first, so
 * neither can see the other half-done: a co-founder never joins between
 * the signer's checks and the deed being stored, and their statement
 * never describes a deed state that changed under them.
 */
export async function lockFoundation(tx: Prisma.TransactionClient, foundationId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "foundations" WHERE "id" = ${foundationId} FOR UPDATE`;
}
