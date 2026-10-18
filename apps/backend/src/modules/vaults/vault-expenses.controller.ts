import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { VaultExpensesService, CreateVaultExpenseInput } from "./vault-expenses.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

// No approve/reject route — recording an expense is plain staff CRUD,
// same trust tier as VaultDistributionsController.create() (only
// vault.milestone_complete, the real fiduciary checkpoint here, is
// governed — see VaultExpense's own schema comment).
@Controller("vault-expenses")
export class VaultExpensesController {
  constructor(private readonly service: VaultExpensesService) {}

  @Post()
  @RequiresStaffRole("mutawalli_officer")
  create(@Body() body: CreateVaultExpenseInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("vaultId") vaultId: string) {
    return this.service.list(vaultId);
  }
}
