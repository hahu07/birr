import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { InvestmentsService, CreateInvestmentInput } from "./investments.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

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

  @Get()
  list(@Query("waqfId") waqfId?: string) {
    return this.service.list(waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const investment = await this.service.findById(id);
    if (!investment) throw new NotFoundException(`Investment "${id}" not found.`);
    return investment;
  }
}
