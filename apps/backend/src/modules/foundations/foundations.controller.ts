import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { FoundationsService, CreateFoundationInput } from "./foundations.service";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
import { isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

// @Public() — Founder-Portal self-service surface, same reasoning as
// FoundersController.
@Public()
@Controller("foundations")
export class FoundationsController {
  constructor(private readonly service: FoundationsService) {}

  // Self-service: a signed-in founder creates their own (2nd+) Foundation
  // directly, no Birr staff involvement or approval gate. If a session
  // cookie is present, founderIds is forced to just that founder — a
  // caller can't attribute a new Foundation to a different founder just
  // by naming their id in the body. Joint/multi-founder Foundations stay
  // a manual, direct-API operation (no session) for now. The *first*
  // Foundation, bundled with Founder creation, goes through
  // POST /founders/establish instead — see FoundersController.
  @Post()
  async create(@Body() body: CreateFoundationInput, @Req() request: Request) {
    // A request with NO session cookie at all is NOT a trusted
    // "system"/direct-API caller — that assumption (see
    // CreateFoundationInput.founderIds's own comment, now stale) let an
    // anonymous caller create a Foundation attached to ARBITRARY existing
    // founderIds of their choosing (2026-08-30 security audit fix — see
    // docs/comprehensive-code-review-prompt.md). A genuine internal/
    // script caller should authenticate as Birr staff, same as every
    // other trusted-caller path in this codebase.
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      // Establishing a new Foundation is an org-commitment action — same
      // restriction as deed-signing/waqf-fund establishment, not
      // something a viewer/requester colleague can do on the org's behalf.
      assertPrimaryContact(founder);
      return this.service.create({ ...body, founderIds: [founder.id] }, { type: "founder", founderId: founder.id });
    }
    return this.service.create(body);
  }

  // Same session-priority pattern as WaqfsController.list() — a founder
  // Portal caller's session is authoritative and overrides any
  // client-supplied ?founderId= query param, so a session can't widen
  // its own scope just by editing the URL. Falls through to the
  // unscoped path both when there's no session AND when the session
  // belongs to Birr staff rather than a Founder — Ops Console calls this
  // route too, and both now carry the same httpOnly cookie (see
  // isBirrStaffSession's own comment).
  @Get()
  async list(@Query("founderId") founderId: string | undefined, @Req() request: Request) {
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      return this.service.list(founder.id);
    }
    return this.service.list(founderId);
  }

  // Same session-priority pattern as list() — a signed-in Founder can
  // only ever resolve their own foundation here, scoped via both the
  // app-layer WHERE clause and the founder_isolation RLS policy
  // (FoundationsService.findByIdForFounder). 404, not 403 —
  // indistinguishable from "id doesn't exist," so this never confirms
  // another Founder's foundation exists.
  @Get(":id")
  async findById(@Param("id") id: string, @Req() request: Request) {
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const foundation = await this.service.findByIdForFounder(id, founder.id);
      if (!foundation) throw new NotFoundException(`Foundation "${id}" not found.`);
      return foundation;
    }
    const foundation = await this.service.findById(id);
    if (!foundation) throw new NotFoundException(`Foundation "${id}" not found.`);
    return foundation;
  }
}
