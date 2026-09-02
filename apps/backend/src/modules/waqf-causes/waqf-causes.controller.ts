import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { IsString } from "class-validator";
import { Request } from "express";
import { WaqfCausesService, CreateWaqfCauseInput, SelectCauseCategoryInput, AllocateCauseInput } from "./waqf-causes.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

class AllocateProceedsProportionallyBody {
  @IsString()
  waqfId!: string;
}

@Controller("waqf-causes")
export class WaqfCausesController {
  constructor(private readonly service: WaqfCausesService) {}

  @Post()
  create(@Body() body: CreateWaqfCauseInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  // Founder-Portal self-service — picks one of the standard catalog
  // entries (see CauseCategoriesController) for their own waqf. A
  // Founder session is required outright here (no staff fallback, unlike
  // list() below — create() above is already the staff path for a
  // custom, non-catalog cause).
  @Public()
  @Post("select")
  async select(@Body() body: SelectCauseCategoryInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.selectForFounder(body.waqfId, body.causeCategoryId, founder.id);
  }

  // Founder-Portal self-service — the inverse of select() above.
  @Public()
  @Post(":id/unselect")
  async unselect(@Param("id") id: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    await this.service.unselectForFounder(id, founder.id);
    return { ok: true };
  }

  // Founder-Portal self-service — earmarks part of the waqf's
  // distributable pool to this cause. Same org-commitment gate as
  // establishing a waqf or signing the deed: this is still a real
  // declaration about where the fund's money goes, even though it's not
  // a governed_action (see WaqfCausesService.allocate's own comment).
  @Public()
  @Post(":id/allocate")
  async allocate(@Param("id") id: string, @Body() body: AllocateCauseInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.allocate(id, founder.id, String(body.amount));
  }

  // Birr-staff path — the second, additive proceeds pool, distinct from
  // allocate() above. No @Public() — staff session required by default,
  // matching create()'s posture, not the Founder-facing routes.
  @Post(":id/allocate-proceeds")
  allocateProceeds(
    @Param("id") id: string,
    @Body() body: AllocateCauseInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.allocateProceeds(id, staff.userId, String(body.amount));
  }

  // Bulk alternative to allocate-proceeds above — scoped to a waqf, not
  // one cause (hence a top-level route rather than :id/..., which means
  // a WaqfCause id everywhere else in this controller). Same no
  // @Public() posture. See allocateProceedsProportionally's own comment
  // for why this stays staff-triggered, not automatic.
  @Post("allocate-proceeds-proportionally")
  allocateProceedsProportionally(
    @Body() body: AllocateProceedsProportionallyBody,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.allocateProceedsProportionally(body.waqfId, staff.userId);
  }

  // @Public() — also reachable by a signed-in Founder viewing their own
  // waqf's causes (read-only; only Birr staff can create() one). Same
  // session-priority pattern as WaqfsController.list(): a Founder
  // session is authoritative and scoped to waqfs they actually own via
  // listForFounder(); falls through to the unscoped staff path when
  // there's no session or the session belongs to Birr staff.
  @Public()
  @Get()
  async list(
    @Query("waqfId") waqfId: string | undefined,
    @Query("includeInactive") includeInactive: string | undefined,
    @Req() request: Request,
  ) {
    if (!waqfId) {
      throw new BadRequestException("Query parameter waqfId is required.");
    }
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const causes = await this.service.listForFounder(waqfId, founder.id);
      if (causes === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      return causes;
    }
    return this.service.list(waqfId, includeInactive === "true");
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const cause = await this.service.findById(id);
    if (!cause) throw new NotFoundException(`WaqfCause "${id}" not found.`);
    return cause;
  }
}
