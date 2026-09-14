import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { CreateFounderRequestInput, DecideFounderRequestInput, FounderRequestsService } from "./founder-requests.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession, resolveBirrStaffFromSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { Public } from "../../common/guards/public.decorator";

// @Public() at the class level, same dual-session posture as
// MessagesController/AssetsController — a Founder submits/reads their
// own requests, Birr staff triage every waqf they're assigned to. Each
// route below still requires a real session of one kind or the other;
// nothing here is reachable unauthenticated.
@Public()
@Controller("founder-requests")
export class FounderRequestsController {
  constructor(private readonly service: FounderRequestsService) {}

  @Post()
  async create(@Body() body: CreateFounderRequestInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.create(body, founder.id);
  }

  @Get()
  async list(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (await isBirrStaffSession(request)) {
      const staff = await resolveBirrStaffFromSession(request);
      if (waqfId) {
        await this.service.assertStaffCanAccessWaqf(waqfId, staff);
      }
      return this.service.list(waqfId, staff);
    }
    const founder = await resolveFounderFromSession(request);
    return this.service.listForFounder(founder.id, waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string, @Req() request: Request) {
    if (await isBirrStaffSession(request)) {
      const staff = await resolveBirrStaffFromSession(request);
      const existing = await this.service.findById(id);
      if (!existing) throw new NotFoundException(`Founder request "${id}" not found.`);
      await this.service.assertStaffCanAccessWaqf(existing.waqfId, staff);
      return existing;
    }
    const founder = await resolveFounderFromSession(request);
    const existing = await this.service.findByIdForFounder(id, founder.id);
    if (!existing) throw new NotFoundException(`Founder request "${id}" not found.`);
    return existing;
  }

  @Patch(":id")
  async decide(
    @Param("id") id: string,
    @Body() body: DecideFounderRequestInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    const existing = await this.service.findById(id);
    if (!existing) throw new NotFoundException(`Founder request "${id}" not found.`);
    await this.service.assertStaffCanAccessWaqf(existing.waqfId, staff);
    return this.service.decide(id, body, staff);
  }
}
