import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { prisma, Prisma, FounderPermissionLevel } from "@birr/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
}

export interface AuthenticatedFounder {
  id: string;
  name: string;
  // The calling user's own membership tier — primary_contact, viewer, or
  // requester (see FounderPermissionLevel). resolveFounderFromSession
  // resolves any active membership now (see that function's own
  // comment), so a caller that needs to restrict a specific write to the
  // org's principal (establishing a Foundation/Waqf Fund, signing the
  // deed, inviting/revoking team members) must check this explicitly —
  // see assertPrimaryContact below.
  permissionLevel: FounderPermissionLevel;
}

/**
 * Real session resolution — the seam current-birr-staff.ts's own
 * dev-stand-in comment anticipated ("replace this header read with real
 * session/token resolution once that lands; nothing downstream should
 * need to change"). Reads the httpOnly session cookie set by
 * FoundersController's sign-up/login routes, verifies the JWT, and
 * loads the User it names.
 *
 * Deliberately NOT gated on `status === "active"` here — a user who has
 * just signed up but not yet clicked the email verification link still
 * needs a valid session to reach the "verify your email" step; that
 * gate belongs to assertEmailVerified/assertWhatsAppVerified below,
 * which run at the write paths that actually require it.
 */
export async function resolveUserFromSession(request: Request): Promise<AuthenticatedUser> {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    throw new UnauthorizedException("Not signed in.");
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    throw new UnauthorizedException("Session expired or invalid — please sign in again.");
  }
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.deletedAt) {
    throw new UnauthorizedException("Session expired or invalid — please sign in again.");
  }
  return { id: user.id, email: user.email, fullName: user.fullName };
}

/**
 * For routes that require an already-established Founder (Foundation
 * #2+, Waqf, Contribution, WaqfDeed, and every founder-scoped read) —
 * resolves the session User, then *any* active FounderMembership of
 * theirs, not just primary_contact. Before team invites existed, every
 * membership WAS a primary_contact one (the only path that created a
 * FounderMembership was establishFounderAndFoundation), so filtering on
 * that was equivalent to "any real founder user" — restricting to it
 * literally here would leave every invited viewer/requester colleague
 * unable to reach anything after accepting their invite. Callers that
 * need to restrict a specific action to the org's principal must check
 * `.permissionLevel` themselves — see assertPrimaryContact below. A
 * user who hasn't completed onboarding step 2 yet has no membership at
 * all, which is a genuine "you haven't done this yet" state, not an
 * auth failure — surfaced as 404, not 401/403.
 */
export async function resolveFounderFromSession(request: Request): Promise<AuthenticatedFounder> {
  const user = await resolveUserFromSession(request);
  const membership = await prisma.founderMembership.findFirst({
    where: { userId: user.id, status: "active" },
    include: { founder: true },
  });
  if (!membership) {
    throw new NotFoundException("Establish your Foundation first.");
  }
  return { id: membership.founder.id, name: membership.founder.name, permissionLevel: membership.permissionLevel };
}

/**
 * Gate for the org-principal-only actions: establishing a new Foundation
 * or Waqf Fund, initiating a contribution, signing the waqf deed,
 * inviting or revoking a team member. A viewer/requester colleague can
 * use everything else a Founder session reaches; this is the explicit
 * line for "commits the organization to something."
 */
export function assertPrimaryContact(founder: AuthenticatedFounder): void {
  if (founder.permissionLevel !== "primary_contact") {
    throw new ForbiddenException("Only the primary contact for this Foundation can do this.");
  }
}

/**
 * User-keyed counterparts to assertEmailVerified/assertWhatsAppVerified
 * below, for the two write paths that run BEFORE a Founder exists yet
 * (WhatsAppVerificationService, FoundersService.establishFounderAndFoundation)
 * — synchronous since the caller already has the User row in hand, no
 * extra DB round-trip needed.
 */
export function assertUserEmailVerified(user: { status: string }): void {
  if (user.status !== "active") {
    throw new ForbiddenException("Verify your email to continue — check your inbox.");
  }
}

export function assertUserWhatsAppVerified(user: { whatsappVerifiedAt: Date | null }): void {
  if (!user.whatsappVerifiedAt) {
    throw new ForbiddenException("Verify your WhatsApp number to continue.");
  }
}

async function findPrimaryContactMembership(
  tx: Prisma.TransactionClient | typeof prisma,
  founderId: string,
) {
  return tx.founderMembership.findFirst({
    where: { founderId, permissionLevel: "primary_contact" },
    include: { user: true },
  });
}

/**
 * Step 1a of onboarding. Founders created via the older, unauthenticated
 * create() path (no signUp(), no FounderMembership at all) have no
 * primary_contact row and are treated as verified — this check only
 * applies once a real primary_contact User exists.
 */
export async function assertEmailVerified(
  tx: Prisma.TransactionClient | typeof prisma,
  founderId: string,
): Promise<void> {
  const membership = await findPrimaryContactMembership(tx, founderId);
  if (membership && membership.user.status !== "active") {
    throw new ForbiddenException("Verify your email to continue — check your inbox.");
  }
}

/**
 * Step 1b of onboarding — same legacy carve-out as assertEmailVerified.
 */
export async function assertWhatsAppVerified(
  tx: Prisma.TransactionClient | typeof prisma,
  founderId: string,
): Promise<void> {
  const membership = await findPrimaryContactMembership(tx, founderId);
  if (membership && !membership.user.whatsappVerifiedAt) {
    throw new ForbiddenException("Verify your WhatsApp number to continue.");
  }
}

/**
 * Guards the self-service write paths (Foundation creation, Waqf Fund
 * creation, Contribution initiation) against an incomplete step 1: a
 * Founder whose primary_contact hasn't verified both email and WhatsApp
 * shouldn't be able to establish anything. Composing the two checks here
 * means every existing call site of assertFounderVerified transparently
 * started requiring WhatsApp too, with no call-site change needed.
 */
export async function assertFounderVerified(
  tx: Prisma.TransactionClient | typeof prisma,
  founderId: string,
): Promise<void> {
  await assertEmailVerified(tx, founderId);
  await assertWhatsAppVerified(tx, founderId);
}
