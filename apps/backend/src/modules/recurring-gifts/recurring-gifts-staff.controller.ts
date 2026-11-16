import { Trimmed } from "../../common/validation/fields";
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RecurringGiftsService } from "./recurring-gifts.service";

export class StaffCancelRecurringGiftInput {
  @Trimmed()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

/** Ops Console: monthly giving (giving.monthly_view), and Compliance stopping a gift (giving.monthly_cancel). */
@Controller("recurring-gifts")
export class RecurringGiftsStaffController {
  constructor(private readonly service: RecurringGiftsService) {}

  @Get()
  @RequiresAccess("giving.monthly_view")
  list(@Query("status") status?: string, @Query("kind") kind?: string) {
    return this.service.staffList({ status, kind });
  }

  @Get(":id")
  @RequiresAccess("giving.monthly_view")
  detail(@Param("id") id: string) {
    return this.service.staffDetail(id);
  }

  @Post(":id/cancel")
  @RequiresAccess("giving.monthly_cancel")
  cancel(@Param("id") id: string, @Body() body: StaffCancelRecurringGiftInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.staffCancel(id, body.reason, staff.userId);
  }
}
