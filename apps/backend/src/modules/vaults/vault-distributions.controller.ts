import { Controller, Post, Get, Param, Body, NotFoundException, Query } from "@nestjs/common";
import { VaultDistributionsService, CreateVaultDistributionInput } from "./vault-distributions.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// No approve/reject route here, deliberately — vault.distribution_approve
// is always a governed_actions action, invoked only internally from
// GovernedActionsService.decide(). Same posture as DistributionsController.
@Controller("vault-distributions")
export class VaultDistributionsController {
  constructor(private readonly service: VaultDistributionsService) {}

  @Post()
  create(@Body() body: CreateVaultDistributionInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("vaultId") vaultId: string | undefined) {
    return this.service.list(vaultId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const distribution = await this.service.findById(id);
    if (!distribution) throw new NotFoundException(`VaultDistribution "${id}" not found.`);
    return distribution;
  }
}
