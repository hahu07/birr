import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { IsString } from "class-validator";
import { Request } from "express";
import {
  WaqfCausesService,
  CreateWaqfCauseInput,
  SelectCauseCategoryInput,
  AllocateCauseInput,
  MoveAllocationInput,
  UnselectCauseInput,
  UpdateWaqfCauseProjectPlanInput,
} from "./waqf-causes.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";
import { RequiresAccess } from "../../common/guards/permission.guard";

class AllocateProceedsProportionallyBody {
  @IsString()
  waqfId!: string;
}

@Controller("waqf-causes")
export class WaqfCausesController {
  constructor(private readonly service: WaqfCausesService) {}

  @Post()
  @RequiresAccess("waqf.cause_manage")
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
  async unselect(@Param("id") id: string, @Body() body: UnselectCauseInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    // Removing a cause that has an allocation needs the primary contact
    // and a reason (2026-11-16); the service decides, since only it
    // knows whether the cause has one.
    await this.service.unselectForFounder(id, founder.id, {
      reason: body?.reason,
      isPrimaryContact: founder.permissionLevel === "primary_contact",
    });
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
    return this.service.allocate(id, founder.id, String(body.amount), body.reason);
  }

  // Founder-Portal self-service (2026-11-16) — moves part of one cause's
  // allocation to another cause of the same fund in one step. Same gate
  // as allocate() above.
  @Public()
  @Post(":id/move")
  async move(@Param("id") id: string, @Body() body: MoveAllocationInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.moveAllocation(id, founder.id, { toCauseId: body.toCauseId, amount: String(body.amount), reason: body.reason });
  }

  // Birr-staff path — the second, additive proceeds pool, distinct from
  // allocate() above. No @Public() — staff session required by default,
  // matching create()'s posture, not the Founder-facing routes.
  @Post(":id/allocate-proceeds")
  @RequiresAccess("waqf.proceeds_allocate")
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
  @RequiresAccess("waqf.proceeds_allocate")
  allocateProceedsProportionally(
    @Body() body: AllocateProceedsProportionallyBody,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.allocateProceedsProportionally(body.waqfId, staff.userId);
  }

  // Birr-staff path — see WaqfCause.projectPlan's own schema comment for
  // why this stays staff-authored, unlike allocate() above. No
  // @Public() — staff session required by default, same posture as
  // create()/allocateProceeds() above.
  @Post(":id/project-plan")
  @RequiresAccess("waqf.cause_manage")
  updateProjectPlan(
    @Param("id") id: string,
    @Body() body: UpdateWaqfCauseProjectPlanInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.updateProjectPlan(id, staff.userId, body.projectPlan);
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

  // Founder-Portal — where this fund's allocation stands, worked out
  // the way allocate() checks it (2026-11-16). Declared before ":id".
  @Public()
  @Get("allocation-summary")
  async allocationSummary(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
    if (!hasAnySessionCookie(request)) throw new UnauthorizedException("Not signed in.");
    const founder = await resolveFounderFromSession(request);
    const summary = await this.service.allocationSummaryForFounder(waqfId, founder.id);
    if (!summary) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
    return summary;
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const cause = await this.service.findById(id);
    if (!cause) throw new NotFoundException(`WaqfCause "${id}" not found.`);
    return cause;
  }
}
