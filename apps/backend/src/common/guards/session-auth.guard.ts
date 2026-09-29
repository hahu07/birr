import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { AuthenticatedBirrStaff, resolveBirrStaffFromSession } from "../auth/current-birr-staff";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { assertStaffMfa } from "./mfa-exempt.decorator";

/**
 * Default-deny floor for every route in the app: requires a valid
 * Birr-staff session unless the route (or its whole controller) is
 * marked @Public(). Runs before PermissionGuard/StaffRoleGuard (see
 * providers order in app.module.ts) — those two guards keep
 * independently resolving staff for their own eligibility checks; this
 * guard's job is only to make "no guard metadata at all" mean "still
 * requires being signed in," not "wide open," which is what let 8+
 * controllers (assets, audit-logs, beneficiaries, birr-staff,
 * distributions, investments, waqf-causes, ai-agents, plus several
 * ungated read routes elsewhere) go unauthenticated before this guard
 * existed.
 *
 * 2026-09-08: also the actual enforcement point for mandatory MFA — a
 * resolved session with mfaEnabled: false is rejected outright on any
 * route not marked @MfaExempt() (enrollment itself, and GET /me so the
 * frontend can even learn this). AppShell's redirect to /ops/mfa-setup
 * is a UX convenience on top of this, same relationship it already has
 * to the plain signed-out case.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const staff = await resolveBirrStaffFromSession(request);
    (request as Request & { birrStaff: AuthenticatedBirrStaff }).birrStaff = staff;

    assertStaffMfa(this.reflector, context, staff);
    return true;
  }
}
