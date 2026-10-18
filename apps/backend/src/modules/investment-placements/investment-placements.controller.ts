import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  CreateInvestmentPlacementInput,
  InvestmentPlacementsService,
  RecordPlacementProceedsInput,
} from "./investment-placements.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

// Birr-staff only, same trust level as InvestmentsController/
// WaqfProceedsController — placing waqf money with a counterparty (or
// recording what it returned) is Birr's own affair, never a Founder
// concern. No @Public() anywhere on this controller.
@Controller("investment-placements")
export class InvestmentPlacementsController {
  constructor(private readonly service: InvestmentPlacementsService) {}

  @Post()
  @RequiresStaffRole("investment_committee")
  create(@Body() body: CreateInvestmentPlacementInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("counterpartyId") counterpartyId?: string) {
    return this.service.list(counterpartyId);
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.service.findById(id);
  }

  @Post(":id/proceeds")
  @RequiresStaffRole("investment_committee")
  recordProceeds(
    @Param("id") id: string,
    @Body() body: RecordPlacementProceedsInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.recordProceeds(id, body, staff.userId);
  }
}
