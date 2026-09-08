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
 * once in the same browser (e.g. Birr staff also testing their own
 * Founder account) — WaqfsController/FoundationsController's
 * list()/findById() (and every other dual-purpose route) check this
 * first and treat the request as a staff caller when it resolves,
 * falling back to the Founder cookie otherwise.
 *
 * That cookie-presence precedence used to be unconditional, which meant
 * a Founder Portal page, called from a browser that also happened to
 * hold a valid staff cookie, silently got the unscoped/staff view of a
 * shared endpoint instead of its own founder-scoped one (found
 * 2026-09-03 — a founder's onboarding page rendered an unrelated
 * fixture waqf belonging to no one they'd established). Fixed at the
 * one place every one of those ~20 call sites already goes through:
 * apps/web/lib/api.ts now sends which portal a request is actually
 * for as `x-birr-portal` (derived from the request path, not from
 * which cookies exist), and a request explicitly marked "founder"
 * short-circuits to false here without even attempting to resolve the
 * staff cookie — regardless of whether one is present. A request with
 * no header (any non-browser caller — the agent service, a script) or
 * marked "ops" keeps the exact previous behavior.
 */
export async function isBirrStaffSession(request: Request): Promise<boolean> {
  if (request.headers?.["x-birr-portal"] === "founder") {
    return false;
  }
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
