import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { RecordWaqfProceedsInput, WaqfProceedsService } from "./waqf-proceeds.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

@Controller("waqf-proceeds")
export class WaqfProceedsController {
  constructor(private readonly service: WaqfProceedsService) {}

  @Post()
  record(@Body() body: RecordWaqfProceedsInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.record(body, staff.userId);
  }

  // @Public() — also reachable by a signed-in Founder viewing their own
  // waqf's recorded proceeds (read-only; only Birr staff can record()).
  // Same session-priority pattern as AssetsController.list().
  @Public()
  @Get()
  async list(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
      const founder = await resolveFounderFromSession(request);
      const proceeds = await this.service.listForFounder(waqfId, founder.id);
      if (proceeds === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      return proceeds;
    }
    return this.service.list(waqfId);
  }
}
