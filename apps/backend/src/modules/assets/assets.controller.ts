import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { AssetsService, CreateAssetInput } from "./assets.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

@Controller("assets")
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  // No dispose route here, deliberately — asset.dispose is always a
  // governed_actions action (see AssetsService.dispose's comment). It's
  // only ever invoked internally, from GovernedActionsService.decide().

  @Post()
  create(@Body() body: CreateAssetInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, { actorType: "birr_staff", actorUserId: staff.userId });
  }

  // @Public() — also reachable by a signed-in Founder viewing their own
  // waqf's registered assets (read-only; only Birr staff can create() or
  // dispose one). Same session-priority pattern as
  // WaqfCausesController.list(): a Founder session is authoritative and
  // scoped via listForFounder(); falls through to the unscoped staff path
  // when there's no session or the session belongs to Birr staff.
  @Public()
  @Get()
  async list(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (request.cookies?.[SESSION_COOKIE_NAME] && !(await isBirrStaffSession(request))) {
      if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
      const founder = await resolveFounderFromSession(request);
      const assets = await this.service.listForFounder(waqfId, founder.id);
      if (assets === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      return assets;
    }
    return this.service.list(waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const asset = await this.service.findById(id);
    if (!asset) throw new NotFoundException(`Asset "${id}" not found.`);
    return asset;
  }
}
