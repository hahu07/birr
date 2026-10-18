import { Body, Controller, Delete, Get, NotFoundException, Param, Put } from "@nestjs/common";
import {
  CompliancePolicySetsService,
  UpsertCompliancePolicySetInput,
} from "./compliance-policy-sets.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Same posture as TrusteeLicensesController: reads default to any
// authenticated staff, writes are platform_admin-only. jurisdiction is
// the natural key (route param), same precedent as
// PlatformSettingsController's :provider/:key.
@Controller("compliance-policy-sets")
export class CompliancePolicySetsController {
  constructor(private readonly service: CompliancePolicySetsService) {}

  @Put(":jurisdiction")
  @RequiresAccess("jurisdiction.manage")
  upsert(
    @Param("jurisdiction") jurisdiction: string,
    @Body() body: UpsertCompliancePolicySetInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.upsert(jurisdiction, body, staff.userId);
  }

  @Delete(":jurisdiction")
  @RequiresAccess("jurisdiction.manage")
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
