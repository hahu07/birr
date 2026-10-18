import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { WaqfLedgerAccountsService, CreateWaqfLedgerAccountInput } from "./waqf-ledger-accounts.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresAccess } from "../../common/guards/permission.guard";

// No @Public() — this is the Waqf side's own chart of accounts, an
// internal accounting concern, never something a Founder needs to see
// directly (they see the ledger's outputs — spentByCurrency-derived
// figures on their own portfolio page — not the chart itself). Writes
// are platform_admin-only, same posture as VaultLedgerAccountsController.
@Controller("waqf-ledger-accounts")
export class WaqfLedgerAccountsController {
  constructor(private readonly service: WaqfLedgerAccountsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RequiresAccess("waqf.ledger_account_manage")
  create(@Body() body: CreateWaqfLedgerAccountInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Post(":id/retire")
  @RequiresAccess("waqf.ledger_account_manage")
  async retire(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    await this.service.retire(id, staff.userId);
    return { ok: true };
  }
}
