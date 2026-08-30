import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { CauseImpactUpdatesService, CreateCauseImpactUpdateInput } from "./cause-impact-updates.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

// @Public() — also reachable read-only by the owning Founder (their own
// waqf's cause only), same session-priority pattern as
// WaqfCausesController.list(). Only Birr staff can create() one.
@Public()
@Controller("cause-impact-updates")
export class CauseImpactUpdatesController {
  constructor(private readonly service: CauseImpactUpdatesService) {}

  @Post()
  create(@Body() body: CreateCauseImpactUpdateInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  async list(@Query("waqfCauseId") waqfCauseId: string | undefined, @Req() request: Request) {
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    const isFounderSession = !(await isBirrStaffSession(request));

    // Omitting waqfCauseId is only meaningful for a Founder session — the
    // standalone Impact page's "everything across my portfolio" view.
    // Staff always views one cause at a time, from that waqf's own page.
    if (!waqfCauseId) {
      if (!isFounderSession) {
        throw new BadRequestException("Query parameter waqfCauseId is required.");
      }
      const founder = await resolveFounderFromSession(request);
      return this.service.listAllForFounder(founder.id);
    }

    if (isFounderSession) {
      const founder = await resolveFounderFromSession(request);
      const updates = await this.service.listForFounder(waqfCauseId, founder.id);
      if (updates === null) throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);
      return updates;
    }
    return this.service.list(waqfCauseId);
  }
}
