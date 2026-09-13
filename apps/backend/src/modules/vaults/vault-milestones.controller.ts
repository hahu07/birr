import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { VaultMilestonesService, CreateVaultMilestoneInput } from "./vault-milestones.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// No complete/approve route here, deliberately — vault.milestone_complete
// is always a governed_actions action, invoked only internally from
// GovernedActionsService.decide(). Same posture as
// VaultDistributionsController (its own approve() lives the same way).
@Controller("vault-milestones")
export class VaultMilestonesController {
  constructor(private readonly service: VaultMilestonesService) {}

  @Post()
  create(@Body() body: CreateVaultMilestoneInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("vaultId") vaultId: string) {
    return this.service.list(vaultId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const milestone = await this.service.findById(id);
    if (!milestone) throw new NotFoundException(`VaultMilestone "${id}" not found.`);
    return milestone;
  }
}
