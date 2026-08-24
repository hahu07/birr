import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

export interface AuthenticatedBirrStaff {
  id: string;
  userId: string;
  staffRole: string;
}

/**
 * Real session resolution — replaces the old header-trust stand-in.
 * Reads the same httpOnly session cookie the Founder side already uses
 * (common/auth/session.ts), verifies the JWT, loads the User it names,
 * then resolves the BirrStaff row for that User. Nothing downstream
 * (PermissionGuard, StaffRoleGuard, SessionAuthGuard, @CurrentBirrStaff())
 * needed to change, since they all call this same function.
 */
export async function resolveBirrStaffFromSession(
  request: Request,
): Promise<AuthenticatedBirrStaff> {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
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
 * Non-throwing check for "is this session's cookie a Birr-staff session"
 * — used where a route needs to tell a Birr-staff caller apart from a
 * Founder caller when BOTH now carry the exact same httpOnly
 * birr_session cookie (they share one JWT scheme; only the User they
 * name differs). WaqfsController/FoundationsController's list()/
 * findById() need this: before Birr staff had real sessions, "a session
 * cookie is present" *did* mean "this is a Founder session," since staff
 * used the old x-birr-staff-id header instead — that assumption broke
 * the moment staff sessions became real cookies too, so those routes
 * must check this first and only treat the cookie as a Founder session
 * when it isn't a staff one.
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
