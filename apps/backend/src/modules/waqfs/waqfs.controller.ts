import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { CreateWaqfInput, IncreaseCorpusTargetInput, WaqfsService } from "./waqfs.service";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
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
  // Org-commitment action — restricted to the primary contact, same as
  // Foundation establishment and deed-signing.
  @Post()
  async create(@Body() body: CreateWaqfInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.createSelfService({ ...body, founderId: founder.id });
  }

  // Founder-Portal self-service — raises this waqf's own declared corpus
  // target. Same org-commitment gate as create() above (primary contact
  // only): a bigger pledge is still a pledge.
  @Post(":id/increase-corpus-target")
  async increaseCorpusTarget(
    @Param("id") id: string,
    @Body() body: IncreaseCorpusTargetInput,
    @Req() request: Request,
  ) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.increaseCorpusTarget(id, founder.id, body.corpusAmount);
  }

  @Get()
  async list(
    @Query("founderId") founderId: string | undefined,
    @Query("type") type: string | undefined,
    @Query("search") search: string | undefined,
    @Req() request: Request,
  ) {
    // A founder-portal caller identifies itself via its session cookie —
    // that's authoritative and overrides any client-supplied
    // ?founderId= query param entirely, so a founder-portal session can
    // never widen its own scope just by editing the URL. When the
    // session belongs to Birr staff rather than a Founder (Ops Console
    // calls this route too, and both now carry the same httpOnly
    // cookie — see isBirrStaffSession's own comment), the query param
    // works as an ops filtering convenience. A request with NO session
    // cookie at all is neither of those — it must not be treated as a
    // trusted ops caller (2026-08-30 security audit fix: this exact
    // "absent session = trusted" assumption previously let this route
    // return the full unscoped waqf list to anyone, unauthenticated —
    // see docs/comprehensive-code-review-prompt.md).
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      return this.service.list(founder.id, { type, search });
    }
    return this.service.list(founderId, { type, search });
  }

  // Same session-priority pattern as list() — a signed-in Founder can
  // only ever resolve their own waqf here, scoped via both the app-layer
  // WHERE clause and the founder_isolation RLS policy
  // (WaqfsService.findByIdForFounder). 404, not 403 — indistinguishable
  // from "id doesn't exist," so this never confirms another Founder's
  // waqf exists.
  // CLAUDE.md's 13 waqf lifecycle stages, computed live — see
  // WaqfsService.getLifecycleStatus's own comment. Same dual-branch
  // ownership shape as findById below: no ordering concern versus that
  // route, ":id" only ever matches one path segment.
  @Get(":id/lifecycle")
  async lifecycle(@Param("id") id: string, @Req() request: Request) {
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const waqf = await this.service.findByIdForFounder(id, founder.id);
      if (!waqf) throw new NotFoundException(`Waqf "${id}" not found.`);
    }
    const status = await this.service.getLifecycleStatus(id);
    if (!status) throw new NotFoundException(`Waqf "${id}" not found.`);
    return status;
  }

  @Get(":id")
  async findById(@Param("id") id: string, @Req() request: Request) {
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
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
