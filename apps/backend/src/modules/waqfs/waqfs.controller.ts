import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { CreateWaqfInput, WaqfsService } from "./waqfs.service";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

// @Public() — Founder-Portal self-service surface, same reasoning as
// FoundersController.
@Public()
@Controller("waqfs")
export class WaqfsController {
  constructor(private readonly service: WaqfsService) {}

  // Self-service — a donor establishes their own Waqf Fund directly, no
  // Birr staff or approval gate involved. Always requires a session;
  // there's no "internal system" caller for this route (a script that
  // needs to create a waqf without a founder session calls
  // WaqfsService.create() directly, not this HTTP route).
  @Post()
  async create(@Body() body: CreateWaqfInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.createSelfService({ ...body, founderId: founder.id });
  }

  @Get()
  async list(@Query("founderId") founderId: string | undefined, @Req() request: Request) {
    // A founder-portal caller identifies itself via its session cookie —
    // that's authoritative and overrides any client-supplied
    // ?founderId= query param entirely, so a founder-portal session can
    // never widen its own scope just by editing the URL. Absent a
    // session, or when the session belongs to Birr staff rather than a
    // Founder (Ops Console calls this route too, and both now carry the
    // same httpOnly cookie — see isBirrStaffSession's own comment), the
    // query param still works as an ops filtering convenience — those
    // callers are trusted already.
    if (request.cookies?.[SESSION_COOKIE_NAME] && !(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      return this.service.list(founder.id);
    }
    return this.service.list(founderId);
  }

  // Same session-priority pattern as list() — a signed-in Founder can
  // only ever resolve their own waqf here, scoped via both the app-layer
  // WHERE clause and the founder_isolation RLS policy
  // (WaqfsService.findByIdForFounder). 404, not 403 — indistinguishable
  // from "id doesn't exist," so this never confirms another Founder's
  // waqf exists.
  @Get(":id")
  async findById(@Param("id") id: string, @Req() request: Request) {
    if (request.cookies?.[SESSION_COOKIE_NAME] && !(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const waqf = await this.service.findByIdForFounder(id, founder.id);
      if (!waqf) throw new NotFoundException(`Waqf "${id}" not found.`);
      return waqf;
    }
    const waqf = await this.service.findById(id);
    if (!waqf) throw new NotFoundException(`Waqf "${id}" not found.`);
    return waqf;
  }
}
