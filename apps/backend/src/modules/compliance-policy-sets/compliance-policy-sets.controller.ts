import { Body, Controller, Delete, Get, NotFoundException, Param, Put } from "@nestjs/common";
import {
  CompliancePolicySetsService,
  UpsertCompliancePolicySetInput,
} from "./compliance-policy-sets.service";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Same posture as TrusteeLicensesController: reads default to any
// authenticated staff, writes are platform_admin-only. jurisdiction is
// the natural key (route param), same precedent as
// PlatformSettingsController's :provider/:key.
@Controller("compliance-policy-sets")
export class CompliancePolicySetsController {
  constructor(private readonly service: CompliancePolicySetsService) {}

  @Put(":jurisdiction")
  @RequiresStaffRole("platform_admin")
  upsert(
    @Param("jurisdiction") jurisdiction: string,
    @Body() body: UpsertCompliancePolicySetInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.upsert(jurisdiction, body, staff.userId);
  }

  @Delete(":jurisdiction")
  @RequiresStaffRole("platform_admin")
  async remove(@Param("jurisdiction") jurisdiction: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    await this.service.remove(jurisdiction, staff.userId);
    return { ok: true };
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":jurisdiction")
  async findByJurisdiction(@Param("jurisdiction") jurisdiction: string) {
    const policySet = await this.service.findByJurisdiction(jurisdiction);
    if (!policySet) throw new NotFoundException(`No compliance policy set configured for jurisdiction "${jurisdiction}".`);
    return policySet;
  }
}
