import { Body, Controller, Get, Param, Post, Query, BadRequestException, Req } from "@nestjs/common";
import { Request } from "express";
import {
  BeneficiaryNominationsService,
  ProposeBeneficiaryNominationInput,
  ProposeBulkBeneficiaryNominationsInput,
  RejectBeneficiaryNominationInput,
} from "./beneficiary-nominations.service";
import { resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";

// @Public() — reachable by a signed-in Founder proposing/listing their
// own nominations (Founder-Portal self-service, same posture as
// CauseCategorySuggestionsController); approve/reject are Birr-staff
// only regardless — see BeneficiaryNominationsService.approve's own
// comment on why that's not further role-restricted.
@Public()
@Controller("beneficiary-nominations")
export class BeneficiaryNominationsController {
  constructor(private readonly service: BeneficiaryNominationsService) {}

  @Post()
  async propose(@Body() body: ProposeBeneficiaryNominationInput, @Req() request: Request) {
    const [founder, user] = await Promise.all([resolveFounderFromSession(request), resolveUserFromSession(request)]);
    return this.service.propose(body, founder.id, user.id);
  }

  // Declared before ":id/..." below — "bulk" is a literal path segment,
  // never confused with an :id, but matching this controller's own
  // "static route before dynamic" convention regardless.
  @Post("bulk")
  async proposeBulk(@Body() body: ProposeBulkBeneficiaryNominationsInput, @Req() request: Request) {
    const [founder, user] = await Promise.all([resolveFounderFromSession(request), resolveUserFromSession(request)]);
    return this.service.proposeBulk(body, founder.id, user.id);
  }

  @Post(":id/approve")
  approve(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.approve(id, staff.userId);
  }

  @Post(":id/reject")
  reject(
    @Param("id") id: string,
    @Body() body: RejectBeneficiaryNominationInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.reject(id, body, staff.userId);
  }

  // A staff session sees every nomination for the waqf; a Founder
  // session sees only their own — same session-priority pattern as
  // CauseCategorySuggestionsController.list().
  @Get()
  async list(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
    if (await isBirrStaffSession(request)) {
      return this.service.list(waqfId);
    }
    const founder = await resolveFounderFromSession(request);
    return this.service.listForFounder(waqfId, founder.id);
  }
}
