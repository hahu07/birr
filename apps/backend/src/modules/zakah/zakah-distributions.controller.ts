import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import {
  CreateZakahDistributionInput,
  CreateZakahRecipientInput,
  RecordPartnerReportInput,
  UpdateZakahRecipientInput,
  ZakahDistributionsService,
} from "./zakah-distributions.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Staff-only throughout (no @Public). Approving a distribution and
// confirming it was paid aren't here: both are governed actions
// (zakah.distribution_approve, zakah.distribution_mark_paid), proposed and
// decided through POST /governed-actions.
@Controller("zakah-distributions")
export class ZakahDistributionsController {
  constructor(private readonly service: ZakahDistributionsService) {}

  @Get("recipients")
  listRecipients() {
    return this.service.listRecipients();
  }

  @Post("recipients")
  @RequiresAccess("zakah.recipient_manage")
  createRecipient(@Body() body: CreateZakahRecipientInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.createRecipient(body, staff.userId);
  }

  @Put("recipients/:id")
  @RequiresAccess("zakah.recipient_manage")
  updateRecipient(@Param("id") id: string, @Body() body: UpdateZakahRecipientInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.updateRecipient(id, body, staff.userId);
  }

  // Full account details for whoever makes the bank transfer — gated and
  // audited, unlike the masked list above.
  @Get("recipients/:id/bank-details")
  @RequiresAccess("zakah.recipient_manage")
  bankDetails(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.bankDetails(id, staff.userId);
  }

  @Get("summary")
  summary() {
    return this.service.summary();
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RequiresAccess("zakah.distribution_create")
  create(@Body() body: CreateZakahDistributionInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Post(":id/partner-report")
  @RequiresAccess("zakah.distribution_create")
  partnerReport(@Param("id") id: string, @Body() body: RecordPartnerReportInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.recordPartnerReport(id, body, staff.userId);
  }
}
