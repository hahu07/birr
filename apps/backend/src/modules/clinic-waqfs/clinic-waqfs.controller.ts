import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import {
  ClinicWaqfsService,
  CreateClinicWaqfInput,
  DraftClinicDeedInput,
  UpdateClinicWaqfInput,
} from "./clinic-waqfs.service";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresAccess } from "../../common/guards/permission.guard";

// Staff only: no @Public() route here. Approving a deed version and
// establishing a clinic waqf go through POST /governed-actions
// (clinic_waqf.deed_approve, clinic_waqf.establish), never a route of
// their own.
@Controller("clinic-waqfs")
export class ClinicWaqfsController {
  constructor(
    private readonly service: ClinicWaqfsService,
    private readonly ledger: ClinicLedgerService,
  ) {}

  @Post()
  @RequiresAccess("clinic_waqf.manage")
  create(@Body() body: CreateClinicWaqfInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Put(":id")
  @RequiresAccess("clinic_waqf.manage")
  update(@Param("id") id: string, @Body() body: UpdateClinicWaqfInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @Post(":id/deeds")
  @RequiresAccess("clinic_waqf.manage")
  draftDeed(@Param("id") id: string, @Body() body: DraftClinicDeedInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.draftDeed(id, body, staff.userId);
  }

  @Post(":id/deeds/:deedId/discard")
  @RequiresAccess("clinic_waqf.manage")
  discardDeed(@Param("id") id: string, @Param("deedId") deedId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.discardDeed(id, deedId, staff.userId);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id/deed-template")
  deedTemplate(@Param("id") id: string) {
    return this.service.deedTemplate(id);
  }

  @Get(":id/ledger")
  balances(@Param("id") id: string, @Query("currency") currency?: string) {
    return this.ledger.balances(id, currency || "NGN");
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.service.findById(id);
  }
}
