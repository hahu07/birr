import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { VaultDonorThresholdsService, UpsertVaultDonorThresholdInput } from "./vault-donor-thresholds.service";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// No @Public() here, deliberately — unlike WaqfFundingController's
// contribution/corpus minimums (informational floors a Founder's own
// form shows in advance), this number is an AML control (see the
// service's own comment); staff-only to even view.
@Controller("vault-donor-thresholds")
export class VaultDonorThresholdsController {
  constructor(private readonly service: VaultDonorThresholdsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Put(":currency")
  @RequiresStaffRole("compliance_officer")
  upsert(
    @Param("currency") currency: string,
    @Body() body: UpsertVaultDonorThresholdInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.upsert(currency, body, staff.userId);
  }
}
