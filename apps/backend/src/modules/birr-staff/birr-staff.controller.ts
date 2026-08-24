import { Body, Controller, Get, NotFoundException, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { BirrStaffService, CreateBirrStaffInput, BirrStaffLoginInput } from "./birr-staff.service";
import {
  AuthenticatedBirrStaff,
  CurrentBirrStaff,
  resolveBirrStaffFromSession,
} from "../../common/auth/current-birr-staff";
import { setSessionCookie, clearSessionCookie, signSessionToken } from "../../common/auth/session";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { Public } from "../../common/guards/public.decorator";

@Controller("birr-staff")
export class BirrStaffController {
  constructor(private readonly service: BirrStaffService) {}

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
