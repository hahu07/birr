import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { prisma } from "@birr/db";
import { STAFF_SESSION_COOKIE_NAME, verifySessionToken } from "./session";
import { assertStaffMfa } from "../guards/mfa-exempt.decorator";

export interface AuthenticatedBirrStaff {
  id: string;
  userId: string;
  staffRole: string;
  // See SessionAuthGuard's own comment — false blocks every route except
  // the ones marked @MfaExempt() (enrollment itself, plus GET /me).
  mfaEnabled: boolean;
}

/**
 * Real session resolution — replaces the old header-trust stand-in.
 * Reads the httpOnly staff session cookie (common/auth/session.ts),
 * verifies the JWT, loads the User it names, then resolves the
 * BirrStaff row for that User.
 *
 * `requireMfa` (default true) is the fail-closed default: mandatory MFA
 * is meant to gate every staff action, not just the ones reached
 * through SessionAuthGuard. Found in a 2026-09-30 audit: SessionAuthGuard
 * only calls assertStaffMfa when it actually runs, but it returns early
 * for any @Public()-marked route/controller — and a large number of
 * "dual-reachable" controllers (founders, invitations, messages,
 * financial-reports, waqfs, contributions, and more) are @Public() so a
 * Founder session can also reach them, then call isBirrStaffSession()/
 * resolveBirrStaffFromSession() directly in the handler body to branch
 * on or resolve the staff caller — with no @RequiresStaffRole/
 * @RequiresPermission on that specific handler to independently enforce
 * MFA the way StaffRoleGuard/PermissionGuard do. That meant a staff
 * session with mfaEnabled: false — which SessionAuthGuard's own doc
 * comment says should be rejected "on any route not marked
 * @MfaExempt()" — could still reach real staff reads/writes on those
 * handlers. Defaulting this function itself to fail closed fixes every
 * such call site at once, without hunting down each one individually.
 *
 * `{ requireMfa: false }` is for the small, deliberate set of callers
 * that already do their own exemption-aware check afterward (guards
 * calling assertStaffMfa(), which honors @MfaExempt()) or that
 * themselves sit behind an @MfaExempt() route (birr-staff.controller.ts's
 * me()) — passing it avoids this function throwing before that more
 * nuanced check gets a chance to run. Every other caller — including
 * isBirrStaffSession() below, which takes no options and so gets the
 * default — should use the default; none of the currently-flagged
 * bypass call sites are meant to be MFA-exempt.
 */
export async function resolveBirrStaffFromSession(
  request: Request,
  options: { requireMfa?: boolean } = {},
): Promise<AuthenticatedBirrStaff> {
  const { requireMfa = true } = options;
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
    include: { user: { select: { mfaEnabled: true } } },
  });
  if (!birrStaff || birrStaff.status !== "active") {
    throw new UnauthorizedException("Unknown or inactive Birr staff.");
  }
  // Same message SessionAuthGuard/StaffRoleGuard/PermissionGuard already
  // throw via assertStaffMfa, so a caller can't tell which layer caught it.
  if (requireMfa && !birrStaff.user.mfaEnabled) {
    throw new ForbiddenException("Two-factor authentication setup is required before continuing.");
  }

  return {
    id: birrStaff.id,
    userId: birrStaff.userId,
    staffRole: birrStaff.staffRole,
    mfaEnabled: birrStaff.user.mfaEnabled,
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
    // Default requireMfa: true (see resolveBirrStaffFromSession's own
    // comment) — a staff session that hasn't completed MFA is treated as
    // "not a valid staff session" here, same fail-closed direction as
    // every other case this function already returns false for, so a
    // caller branching on this never grants staff-level access to one.
    await resolveBirrStaffFromSession(request);
    return true;
  } catch {
    return false;
  }
}

// Stateless (just wraps Reflect.getMetadata) — constructed directly
// rather than injected, since createParamDecorator's factory isn't a
// class and has no constructor to inject into. Same instantiation
// SessionAuthGuard/StaffRoleGuard/PermissionGuard get via DI, just
// without DI available here.
const reflector = new Reflector();

/**
 * The actual logic behind @CurrentBirrStaff() below, exported
 * separately so it's directly unit-testable against a plain mock
 * ExecutionContext rather than only reachable through Nest's decorator
 * machinery.
 *
 * Calls resolveBirrStaffFromSession with requireMfa: false and then
 * assertStaffMfa itself (same two-step shape as every guard in this
 * codebase) rather than relying on that function's own default —
 * @CurrentBirrStaff() is also how birr-staff.controller.ts's two
 * @MfaExempt() enrollment routes get their own staff identity, and
 * those need to stay reachable before MFA is set up. Every other route
 * using @CurrentBirrStaff() (there is no @MfaExempt() metadata on any
 * of them) gets the real check via this same call, same 2026-09-30 fix
 * as resolveBirrStaffFromSession's own default — see that function's
 * comment for the bypass this closes.
 */
export async function resolveCurrentBirrStaff(ctx: ExecutionContext): Promise<AuthenticatedBirrStaff> {
  const staff = await resolveBirrStaffFromSession(ctx.switchToHttp().getRequest<Request>(), { requireMfa: false });
  assertStaffMfa(reflector, ctx, staff);
  return staff;
}

/**
 * For routes that need to know who's calling but aren't gated by a
 * governed_actions permission (see PermissionGuard for that case) — e.g.
 * self-reporting a conflict-of-interest declaration. NestJS awaits async
 * custom-decorator factories (verified directly against
 * @nestjs/core/router/router-execution-context.js before relying on this).
 */
export const CurrentBirrStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  resolveCurrentBirrStaff(ctx),
);
