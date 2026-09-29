import { ExecutionContext, ForbiddenException, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

/**
 * Opts a route out of SessionAuthGuard's MFA-required check (see that
 * guard's own comment) — for the small set of routes a signed-in-but-
 * not-yet-enrolled birr_staff member must still be able to reach:
 * GET /me (so the frontend can even learn mfaEnabled is false) and the
 * two enrollment endpoints themselves. Distinct from @Public() — these
 * routes still require a real, valid staff session; they're just exempt
 * from the *additional* "has this session completed MFA setup" check.
 */
export const IS_MFA_EXEMPT_KEY = "isMfaExempt";
export const MfaExempt = () => SetMetadata(IS_MFA_EXEMPT_KEY, true);

/**
 * The one definition of "this staff session has satisfied mandatory MFA".
 * Called by every guard that resolves a staff session — not only
 * SessionAuthGuard, which returns early on a @Public() controller. Without
 * this, a staff-role- or permission-gated route on a @Public() controller
 * (e.g. cause-categories, waqf-funding) accepted a password-only session.
 */
export function assertStaffMfa(reflector: Reflector, context: ExecutionContext, staff: { mfaEnabled: boolean }): void {
  const isMfaExempt = reflector.getAllAndOverride<boolean>(IS_MFA_EXEMPT_KEY, [context.getHandler(), context.getClass()]);
  if (!staff.mfaEnabled && !isMfaExempt) {
    throw new ForbiddenException("Two-factor authentication setup is required before continuing.");
  }
}
