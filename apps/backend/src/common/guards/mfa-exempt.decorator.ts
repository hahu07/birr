import { SetMetadata } from "@nestjs/common";

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
