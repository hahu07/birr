import { Body, Controller, Get, NotFoundException, Param, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { IsString } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { BirrStaffService, CreateBirrStaffInput, BirrStaffLoginInput } from "./birr-staff.service";
import { BirrStaffWhatsAppService } from "./whatsapp/birr-staff-whatsapp.service";
import {
  AuthenticatedBirrStaff,
  CurrentBirrStaff,
  resolveBirrStaffFromSession,
} from "../../common/auth/current-birr-staff";
import {
  setStaffSessionCookie,
  clearStaffSessionCookie,
  signSessionToken,
  setMfaPendingCookie,
  clearMfaPendingCookie,
  signMfaPendingToken,
  verifyMfaPendingToken,
  MFA_PENDING_COOKIE_NAME,
} from "../../common/auth/session";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { Public } from "../../common/guards/public.decorator";
import { MfaExempt } from "../../common/guards/mfa-exempt.decorator";
import { loginThrottleLimit } from "../../common/auth/login-throttle";

class RequestWhatsAppOtpBody {
  @IsString()
  whatsappNumber!: string;
}

class VerifyWhatsAppOtpBody {
  @IsString()
  code!: string;
}

class VerifyLoginMfaBody {
  @IsString()
  code!: string;
}

class ConfirmMfaEnrollmentBody {
  @IsString()
  code!: string;
}

@Controller("birr-staff")
export class BirrStaffController {
  constructor(
    private readonly service: BirrStaffService,
    private readonly whatsApp: BirrStaffWhatsAppService,
  ) {}

  // Admin/scripted bootstrap only — see BirrStaffService.create's
  // comment. Normal onboarding is an Invitation, which sets a real
  // password and logs the invitee in directly.
  @Post()
  @RequiresStaffRole("platform_admin")
  create(@Body() body: CreateBirrStaffInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  // Brute-force protection on a real credential, same posture as
  // FoundersController.login. @Public() — must be reachable with no
  // session yet; that's the whole point of a login route.
  // mfaEnabled branches: an enrolled account gets a short-lived
  // MFA-pending cookie instead of a real session — see
  // POST login/mfa below and session.ts's own comment on why this is a
  // separate cookie/token, not a half-populated real one. An
  // unenrolled account still gets the real session (MFA is mandatory,
  // not optional, but enrollment itself requires being signed in — see
  // SessionAuthGuard's own comment on what @MfaExempt() lets through in
  // that state).
  @Post("login")
  @Public()
  @Throttle({ default: { limit: loginThrottleLimit(), ttl: 600_000 } })
  async login(@Body() body: BirrStaffLoginInput, @Res({ passthrough: true }) res: Response) {
    const { userId, mfaEnabled } = await this.service.login(body);
    if (mfaEnabled) {
      setMfaPendingCookie(res, signMfaPendingToken(userId));
      return { ok: true, mfaRequired: true };
    }
    setStaffSessionCookie(res, signSessionToken(userId));
    return { ok: true, mfaRequired: false };
  }

  // Step 2 of login for an mfaEnabled account. @Public() — there's no
  // real staff session yet at this point, only the pending-MFA cookie
  // login() just set; that cookie (not a client-supplied userId) is the
  // only source of identity here.
  @Post("login/mfa")
  @Public()
  @Throttle({ default: { limit: loginThrottleLimit(), ttl: 600_000 } })
  async verifyLoginMfa(
    @Body() body: VerifyLoginMfaBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[MFA_PENDING_COOKIE_NAME];
    const payload = token ? verifyMfaPendingToken(token) : null;
    if (!payload) {
      throw new UnauthorizedException("Your sign-in session expired — sign in again.");
    }
    await this.service.verifyLoginMfaCode(payload.userId, body.code);
    clearMfaPendingCookie(res);
    setStaffSessionCookie(res, signSessionToken(payload.userId));
    return { ok: true };
  }

  // @Public() — clearing a stale/expired session cookie shouldn't itself
  // require a currently-valid session.
  @Post("logout")
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    clearStaffSessionCookie(res);
    return { ok: true };
  }

  // Declared before ":id" — otherwise Nest would match GET /birr-staff/me
  // as findById(id: "me") instead of this route. @MfaExempt() — a
  // signed-in-but-not-yet-enrolled staff member still needs this to
  // learn mfaEnabled: false in the first place (see StaffSessionProvider
  // and AppShell's redirect to /ops/mfa-setup).
  @Get("me")
  @MfaExempt()
  async me(@Req() request: Request) {
    // requireMfa: false — this route IS how a not-yet-enrolled session
    // learns mfaEnabled: false in the first place; the function's own
    // default would throw before that ever happened. SessionAuthGuard
    // already validated the @MfaExempt() exemption above this handler.
    const staff = await resolveBirrStaffFromSession(request, { requireMfa: false });
    return this.service.getSessionSummary(staff.userId);
  }

  // Both @MfaExempt() — this IS the setup a not-yet-enrolled staff
  // member is blocked until they complete (see SessionAuthGuard's own
  // comment). @CurrentBirrStaff() still requires a real, valid session;
  // only the *additional* mfaEnabled check is skipped for these two.
  @Post("me/mfa/enroll")
  @MfaExempt()
  async startMfaEnrollment(@CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.startMfaEnrollment(staff.userId);
  }

  @Post("me/mfa/enroll/confirm")
  @MfaExempt()
  async confirmMfaEnrollment(
    @Body() body: ConfirmMfaEnrollmentBody,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.confirmMfaEnrollment(staff.userId, body.code);
  }

  // Self-service WhatsApp verification from a staff member's own
  // profile — no onboarding-order gate (unlike the Founder Portal's
  // equivalent), just "you're signed in." Needed before a staff member
  // can receive a WhatsApp notification at all — see
  // BirrStaffWhatsAppService's own comment.
  @Post("me/whatsapp/request-otp")
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async requestWhatsAppOtp(@Body() body: RequestWhatsAppOtpBody, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.whatsApp.requestOtp(staff.userId, body.whatsappNumber);
  }

  @Post("me/whatsapp/verify-otp")
  async verifyWhatsAppOtp(@Body() body: VerifyWhatsAppOtpBody, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.whatsApp.verifyOtp(staff.userId, body.code);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const staff = await this.service.findById(id);
    if (!staff) throw new NotFoundException(`BirrStaff "${id}" not found.`);
    return staff;
  }

  // Resetting a staff member's MFA is NOT a route here — it's the governed
  // `staff.mfa_reset` action (proposed via POST /governed-actions, approved
  // by a second person). The old one-person POST :id/mfa/reset was removed
  // on purpose; birr-staff.controller.spec.ts asserts it stays gone.
}
