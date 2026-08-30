import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { InvestmentsService, CreateInvestmentInput } from "./investments.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

@Controller("investments")
export class InvestmentsController {
  constructor(private readonly service: InvestmentsService) {}

  // No change-allocation route here, deliberately — investment.change is
  // always a governed_actions action (see
  // InvestmentsService.changeAllocation's comment). It's only ever
  // invoked internally, from GovernedActionsService.decide().

  @Post()
  create(@Body() body: CreateInvestmentInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  // @Public() — also reachable by a signed-in Founder viewing their own
  // waqf's investment allocations (read-only). Same session-priority
  // pattern as AssetsController.list()/WaqfCausesController.list().
  @Public()
  @Get()
  async list(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    // A request with NO session cookie at all must not fall through to
    // the unscoped staff branch below (2026-08-30 security audit fix —
    // see docs/comprehensive-code-review-prompt.md).
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
      const founder = await resolveFounderFromSession(request);
      const investments = await this.service.listForFounder(waqfId, founder.id);
      if (investments === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      return investments;
    }
    return this.service.list(waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const investment = await this.service.findById(id);
    if (!investment) throw new NotFoundException(`Investment "${id}" not found.`);
    return investment;
  }
}
