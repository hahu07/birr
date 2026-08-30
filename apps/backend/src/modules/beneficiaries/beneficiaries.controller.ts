import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { BeneficiariesService, CreateBeneficiaryInput, SetPayoutDetailsInput } from "./beneficiaries.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { Public } from "../../common/guards/public.decorator";

@Controller("beneficiaries")
export class BeneficiariesController {
  constructor(private readonly service: BeneficiariesService) {}

  // No criteria-update route here, deliberately — beneficiary.criteria_update
  // is always a governed_actions action (see BeneficiariesService.updateCriteria's
  // comment). It's only ever invoked internally, from
  // GovernedActionsService.decide().

  @Post()
  create(@Body() body: CreateBeneficiaryInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  // Not maker-checker gated — same posture as create() itself. See
  // BeneficiariesService.setPayoutDetails's own comment on why this
  // route exists: bank details are optional at creation time, so this
  // is the only way an already-registered beneficiary can ever become
  // payout-ready. Declared before ":id" for the same routing reason as
  // DistributionsController.summary().
  @Post(":id/payout-details")
  setPayoutDetails(
    @Param("id") id: string,
    @Body() body: SetPayoutDetailsInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.setPayoutDetails(id, body, staff.userId);
  }

  @Get()
  async list(@Query("waqfId") waqfId?: string) {
    const beneficiaries = await this.service.list(waqfId);
    return beneficiaries.map((b) => this.service.withDecryptedBankDetails(b));
  }

  // Declared before ":id" for the same routing reason as
  // DistributionsController.summary(). Founder-only (no staff fallback,
  // unlike AssetsController.list()) — staff already get full detail via
  // list() above; this exists specifically to give a Founder the
  // aggregate-only, PII-safe cut (see summaryForFounder's own comment on
  // why beneficiary identity itself never crosses into the Founder
  // Portal).
  @Public()
  @Get("summary")
  async summary(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
    const founder = await resolveFounderFromSession(request);
    const summary = await this.service.summaryForFounder(waqfId, founder.id);
    if (summary === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
    return summary;
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const beneficiary = await this.service.findById(id);
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${id}" not found.`);
    return this.service.withDecryptedBankDetails(beneficiary);
  }
}
