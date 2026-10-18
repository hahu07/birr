import { Controller, Post, Get, Body, Query } from "@nestjs/common";
import { VaultProceedsService, RecordVaultProceedsInput } from "./vault-proceeds.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

@Controller("vault-proceeds")
export class VaultProceedsController {
  constructor(private readonly service: VaultProceedsService) {}

  @Post()
  @RequiresStaffRole(["investment_committee", "mutawalli_officer"])
  record(@Body() body: RecordVaultProceedsInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.record(body, staff.userId);
  }

  @Get()
  list(@Query("vaultId") vaultId: string | undefined) {
    return this.service.list(vaultId);
  }
}
