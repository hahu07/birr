import { Body, Controller, Get, NotFoundException, Param, Post, Req, Res } from "@nestjs/common";
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
import { setSessionCookie, clearSessionCookie, signSessionToken } from "../../common/auth/session";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { Public } from "../../common/guards/public.decorator";

class RequestWhatsAppOtpBody {
  @IsString()
  whatsappNumber!: string;
}

class VerifyWhatsAppOtpBody {
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
  @Post("login")
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async login(@Body() body: BirrStaffLoginInput, @Res({ passthrough: true }) res: Response) {
    const { userId } = await this.service.login(body);
    setSessionCookie(res, signSessionToken(userId));
    return { ok: true };
  }

  // @Public() — clearing a stale/expired session cookie shouldn't itself
  // require a currently-valid session.
  @Post("logout")
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
    return { ok: true };
  }

  // Declared before ":id" — otherwise Nest would match GET /birr-staff/me
  // as findById(id: "me") instead of this route.
  @Get("me")
  async me(@Req() request: Request) {
    const staff = await resolveBirrStaffFromSession(request);
    return this.service.getSessionSummary(staff.userId);
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
}
