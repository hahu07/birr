import { Controller, Post, Get, Param, Body, NotFoundException, Query } from "@nestjs/common";
import { VaultInvestmentsService, CreateVaultInvestmentInput, RecordVaultShariahScreeningInput } from "./vault-investments.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

// No change-allocation route here, deliberately — vault.investment_change
// is always a governed_actions action, invoked only internally from
// GovernedActionsService.decide(). Same posture as InvestmentsController.
@Controller("vault-investments")
export class VaultInvestmentsController {
  constructor(private readonly service: VaultInvestmentsService) {}

  @Post()
  create(@Body() body: CreateVaultInvestmentInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("vaultId") vaultId: string | undefined) {
    return this.service.list(vaultId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const investment = await this.service.findById(id);
    if (!investment) throw new NotFoundException(`VaultInvestment "${id}" not found.`);
    return investment;
  }

  // Single shariah_board_member sign-off, not governed_actions — mirrors
  // InvestmentsController's own equivalent route exactly.
  @RequiresStaffRole("shariah_board_member")
  @Post(":id/shariah-screening/decide")
  decideShariahScreening(
    @Param("id") id: string,
    @Body() body: RecordVaultShariahScreeningInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.recordShariahScreening(id, body, staff.userId);
  }
}
