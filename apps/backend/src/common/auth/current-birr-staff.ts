import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { STAFF_SESSION_COOKIE_NAME, verifySessionToken } from "./session";

export interface AuthenticatedBirrStaff {
  id: string;
  userId: string;
  staffRole: string;
}

/**
 * Real session resolution — replaces the old header-trust stand-in.
 * Reads the httpOnly staff session cookie (common/auth/session.ts),
 * verifies the JWT, loads the User it names, then resolves the
 * BirrStaff row for that User. Nothing downstream (PermissionGuard,
 * StaffRoleGuard, SessionAuthGuard, @CurrentBirrStaff()) needed to
 * change, since they all call this same function.
 */
export async function resolveBirrStaffFromSession(
  request: Request,
): Promise<AuthenticatedBirrStaff> {
  const token = request.cookies?.[STAFF_SESSION_COOKIE_NAME];
  if (!token) {
    throw new UnauthorizedException("Not signed in.");
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    throw new UnauthorizedException("Session expired or invalid — please sign in again.");
  }

  const birrStaff = await prisma.birrStaff.findUnique({
    where: { userId: payload.userId },
  });
  if (!birrStaff || birrStaff.status !== "active") {
    throw new UnauthorizedException("Unknown or inactive Birr staff.");
  }

  return {
    id: birrStaff.id,
    userId: birrStaff.userId,
    staffRole: birrStaff.staffRole,
  };
}

/**
 * Non-throwing check for "does this request carry a valid Birr-staff
 * session" — used where a route needs to tell a Birr-staff caller apart
 * from a Founder caller. Founder and staff sessions are now two
 * separate cookies (STAFF_SESSION_COOKIE_NAME vs SESSION_COOKIE_NAME —
 * see the former's own comment), so both can genuinely be present at
 * once in the same browser; WaqfsController/FoundationsController's
 * list()/findById() (and every other dual-purpose route) still check
 * this first and treat the request as a staff caller when it resolves,
 * falling back to the Founder cookie otherwise — an unchanged,
 * deliberate precedence, not a leftover ambiguity from the single-cookie
 * era.
 */
export async function isBirrStaffSession(request: Request): Promise<boolean> {
  try {
    await resolveBirrStaffFromSession(request);
    return true;
  } catch {
    return false;
  }
}

/**
 * For routes that need to know who's calling but aren't gated by a
 * governed_actions permission (see PermissionGuard for that case) — e.g.
 * self-reporting a conflict-of-interest declaration. NestJS awaits async
 * custom-decorator factories (verified directly against
 * @nestjs/core/router/router-execution-context.js before relying on this).
 */
export const CurrentBirrStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    resolveBirrStaffFromSession(ctx.switchToHttp().getRequest<Request>()),
);
