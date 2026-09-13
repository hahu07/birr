import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { VaultLedgerAccountsService, CreateVaultLedgerAccountInput } from "./vault-ledger-accounts.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

// No @Public() — this is Vault's own chart of accounts, an internal
// accounting concern, never something a donor or Founder needs to see.
// Writes are platform_admin-only, same posture as
// CauseCategoriesController's own shared-catalog write gate — a much
// higher-stakes shared resource than any single vault's own rows.
@Controller("vault-ledger-accounts")
export class VaultLedgerAccountsController {
  constructor(private readonly service: VaultLedgerAccountsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RequiresStaffRole("platform_admin")
  create(@Body() body: CreateVaultLedgerAccountInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Post(":id/retire")
  @RequiresStaffRole("platform_admin")
  async retire(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    await this.service.retire(id, staff.userId);
    return { ok: true };
  }
}
