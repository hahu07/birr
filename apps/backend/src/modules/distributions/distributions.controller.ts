import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { DistributionsService, CreateDistributionInput } from "./distributions.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

@Controller("distributions")
export class DistributionsController {
  constructor(private readonly service: DistributionsService) {}

  // No approve route here, deliberately — distribution.approve is always
  // a governed_actions action (see DistributionsService.approve's
  // comment). It's only ever invoked internally, from
  // GovernedActionsService.decide().

  @Post()
  create(@Body() body: CreateDistributionInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("waqfId") waqfId?: string) {
    return this.service.list(waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const distribution = await this.service.findById(id);
    if (!distribution) throw new NotFoundException(`Distribution "${id}" not found.`);
    return distribution;
  }
}
