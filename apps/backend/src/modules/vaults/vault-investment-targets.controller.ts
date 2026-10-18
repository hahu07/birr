import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { InvestmentInstrumentType } from "@birr/db";
import { VaultInvestmentTargetsService, SetVaultInvestmentTargetInput } from "./vault-investment-targets.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresAccess } from "../../common/guards/permission.guard";

@Controller("vault-investment-targets")
export class VaultInvestmentTargetsController {
  constructor(private readonly service: VaultInvestmentTargetsService) {}

  @RequiresAccess("vault.investment_target_set")
  @Post()
  setTarget(
    @Body() body: SetVaultInvestmentTargetInput & { vaultId: string },
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.upsertTarget(body.vaultId, body, staff.userId);
  }

  @Get()
  list(@Query("vaultId") vaultId: string) {
    return this.service.list(vaultId);
  }

  @RequiresAccess("vault.investment_target_set")
  @Delete(":vaultId/:instrumentType")
  remove(
    @Param("vaultId") vaultId: string,
    @Param("instrumentType") instrumentType: InvestmentInstrumentType,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.remove(vaultId, instrumentType, staff.userId);
  }

  @Get(":vaultId/drift")
  getDrift(@Param("vaultId") vaultId: string) {
    return this.service.computeDrift(vaultId);
  }
}
