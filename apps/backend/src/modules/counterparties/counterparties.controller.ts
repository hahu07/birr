import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from "@nestjs/common";
import { IsString } from "class-validator";
import {
  CounterpartiesService,
  RegisterCounterpartyInput,
  UpdateCounterpartyInput,
  SetConcentrationLimitInput,
} from "./counterparties.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { CounterpartyStatus } from "@birr/db";

class StatusChangeInput {
  @IsString()
  reason!: string;
}

// No @Public() anywhere on this controller — a counterparty relationship
// is Birr's own affair, never a Founder concern (CLAUDE.md: ongoing
// governance stays exclusively Birr-staff-mediated). Every route
// requires an authenticated Birr staff session at minimum
// (SessionAuthGuard's default floor), with specific roles required for
// the actions that carry real fiduciary weight.
@Controller("counterparties")
export class CounterpartiesController {
  constructor(private readonly service: CounterpartiesService) {}

  @Post()
  @RequiresStaffRole("investment_committee")
  register(@Body() body: RegisterCounterpartyInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.register(body, staff.userId);
  }

  @Put(":id")
  @RequiresStaffRole("investment_committee")
  update(@Param("id") id: string, @Body() body: UpdateCounterpartyInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @Post(":id/shariah-approval")
  @RequiresStaffRole("shariah_board_member")
  recordShariahApproval(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.recordShariahApproval(id, staff.userId);
  }

  @Put(":id/concentration-limit")
  @RequiresStaffRole("compliance_officer")
  setConcentrationLimit(
    @Param("id") id: string,
    @Body() body: SetConcentrationLimitInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.setConcentrationLimit(id, body, staff.userId);
  }

  @Post(":id/suspend")
  @RequiresStaffRole("compliance_officer")
  suspend(@Param("id") id: string, @Body() body: StatusChangeInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.suspend(id, body.reason, staff.userId);
  }

  @Post(":id/blacklist")
  @RequiresStaffRole("compliance_officer")
  blacklist(@Param("id") id: string, @Body() body: StatusChangeInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.blacklist(id, body.reason, staff.userId);
  }

  // Soft-delete (see CounterpartiesService.deregister's own comment) —
  // same investment_committee gate as registering one in the first
  // place, blocked server-side if it was ever actually used.
  @Post(":id/deregister")
  @RequiresStaffRole("investment_committee")
  deregister(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.deregister(id, staff.userId);
  }

  @Get()
  list(@Query("status") status: CounterpartyStatus | undefined) {
    return this.service.list(status);
  }

  @Get(":id/exposure")
  exposure(@Param("id") id: string) {
    return this.service.exposure(id);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const counterparty = await this.service.findById(id);
    if (!counterparty) throw new NotFoundException(`Counterparty "${id}" not found.`);
    return counterparty;
  }
}
