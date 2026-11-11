import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateZakahRefundInput, ZakahRefundsService } from "./zakah-refunds.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Staff-only. Approving a refund and confirming it was paid are governed
// actions (zakah.refund_approve, zakah.refund_mark_paid), proposed and
// decided through POST /governed-actions.
@Controller("zakah-refunds")
export class ZakahRefundsController {
  constructor(private readonly service: ZakahRefundsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RequiresAccess("zakah.refund_request")
  create(@Body() body: CreateZakahRefundInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  // The payer's full account details, for the officer who makes the
  // transfer (the role that records a refund as paid). Every read is
  // audited. Compliance entered them, so doesn't need to read them back.
  @Get(":id/bank-details")
  @RequiresAccess("zakah.refund_mark_paid")
  bankDetails(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.bankDetails(id, staff.userId);
  }
}
