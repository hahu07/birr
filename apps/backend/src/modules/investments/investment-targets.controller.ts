import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { InvestmentInstrumentType } from "@birr/db";
import { InvestmentTargetsService, SetInvestmentTargetInput } from "./investment-targets.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

@Controller("investment-targets")
export class InvestmentTargetsController {
  constructor(private readonly service: InvestmentTargetsService) {}

  // investment_committee-gated — setting a target allocation is a
  // deliberate portfolio-policy decision, unlike registering an
  // Investment itself (POST /investments has no staff-role gate at
  // all today).
  @RequiresStaffRole("investment_committee")
  @Post()
  setTarget(
    @Body() body: SetInvestmentTargetInput & { waqfId: string },
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.upsertTarget(body.waqfId, body, staff.userId);
  }

  @Get()
  list(@Query("waqfId") waqfId: string) {
    return this.service.list(waqfId);
  }

  @RequiresStaffRole("investment_committee")
  @Delete(":waqfId/:instrumentType")
  remove(
    @Param("waqfId") waqfId: string,
    @Param("instrumentType") instrumentType: InvestmentInstrumentType,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.remove(waqfId, instrumentType, staff.userId);
  }

  @Get(":waqfId/drift")
  getDrift(@Param("waqfId") waqfId: string) {
    return this.service.computeDrift(waqfId);
  }
}
