import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { BeneficiariesService, CreateBeneficiaryInput } from "./beneficiaries.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

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

  @Get()
  list(@Query("waqfId") waqfId?: string) {
    return this.service.list(waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const beneficiary = await this.service.findById(id);
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${id}" not found.`);
    return beneficiary;
  }
}
