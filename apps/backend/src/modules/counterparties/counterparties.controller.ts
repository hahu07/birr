import { LongTextField } from "../../common/validation/fields";
import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from "@nestjs/common";
import {
  CounterpartiesService,
  RegisterCounterpartyInput,
  UpdateCounterpartyInput,
  SetConcentrationLimitInput,
  SetPayoutDetailsInput,
} from "./counterparties.service";
import {
  CounterpartyLicensesService,
  RecordCounterpartyLicenseInput,
  VerifyCounterpartyLicenseInput,
  WithdrawCounterpartyLicenseInput,
} from "./counterparty-licenses.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { CounterpartyStatus } from "@birr/db";

class StatusChangeInput {
  @LongTextField()
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
  constructor(
    private readonly service: CounterpartiesService,
    private readonly licenses: CounterpartyLicensesService,
  ) {}

  @Post()
  @RequiresAccess("counterparty.register")
  register(@Body() body: RegisterCounterpartyInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.register(body, staff.userId);
  }

  @Put(":id")
  @RequiresAccess("counterparty.register")
  update(@Param("id") id: string, @Body() body: UpdateCounterpartyInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @Post(":id/shariah-approval")
  @RequiresAccess("counterparty.shariah_approve")
  recordShariahApproval(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.recordShariahApproval(id, staff.userId);
  }

  @Put(":id/concentration-limit")
  @RequiresAccess("counterparty.restrict")
  setConcentrationLimit(
    @Param("id") id: string,
    @Body() body: SetConcentrationLimitInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.setConcentrationLimit(id, body, staff.userId);
  }

  // Needed before VaultDistributionsService.approve() can succeed for
  // any distribution paying this counterparty — see that service's own
  // assertPayoutReady. mutawalli_officer, matching that role's general
  // case-carrying-operational-detail posture elsewhere in this codebase.
  @Put(":id/payout-details")
  @RequiresAccess("counterparty.payout_details")
  setPayoutDetails(
    @Param("id") id: string,
    @Body() body: SetPayoutDetailsInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.setPayoutDetails(id, body, staff.userId);
  }

  @Post(":id/suspend")
  @RequiresAccess("counterparty.restrict")
  suspend(@Param("id") id: string, @Body() body: StatusChangeInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.suspend(id, body.reason, staff.userId);
  }

  @Post(":id/blacklist")
  @RequiresAccess("counterparty.restrict")
  blacklist(@Param("id") id: string, @Body() body: StatusChangeInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.blacklist(id, body.reason, staff.userId);
  }

  // Soft-delete (see CounterpartiesService.deregister's own comment) —
  // same investment_committee gate as registering one in the first
  // place, blocked server-side if it was ever actually used.
  @Post(":id/deregister")
  @RequiresAccess("counterparty.register")
  deregister(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.deregister(id, staff.userId);
  }

  // Licences (2026-11-17, clinic slice 1): one person records what the
  // certificate says, a different person verifies it, and Compliance can
  // withdraw one at once. See CounterpartyLicense's schema comment.
  @Post(":id/licenses")
  @RequiresAccess("counterparty.license_record")
  recordLicense(
    @Param("id") id: string,
    @Body() body: RecordCounterpartyLicenseInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.licenses.record(id, body, staff.userId);
  }

  @Post(":id/licenses/:licenseId/verify")
  @RequiresAccess("counterparty.license_verify")
  async verifyLicense(
    @Param("id") id: string,
    @Param("licenseId") licenseId: string,
    @Body() body: VerifyCounterpartyLicenseInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    await this.assertLicenseBelongsTo(id, licenseId);
    return this.licenses.verify(licenseId, body, staff.userId);
  }

  @Post(":id/licenses/:licenseId/withdraw")
  @RequiresAccess("counterparty.license_withdraw")
  async withdrawLicense(
    @Param("id") id: string,
    @Param("licenseId") licenseId: string,
    @Body() body: WithdrawCounterpartyLicenseInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    await this.assertLicenseBelongsTo(id, licenseId);
    return this.licenses.withdraw(licenseId, body, staff.userId);
  }

  @Get(":id/licenses")
  listLicenses(@Param("id") id: string) {
    return this.licenses.list(id);
  }

  private async assertLicenseBelongsTo(counterpartyId: string, licenseId: string) {
    const { licenses } = await this.licenses.list(counterpartyId);
    if (!licenses.some((l) => l.id === licenseId)) throw new NotFoundException(`Licence "${licenseId}" not found.`);
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
