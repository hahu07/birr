import { Controller, Post, Body, Get, Param, NotFoundException } from "@nestjs/common";
import { VaultContributionsService, InitiateVaultContributionInput } from "./vault-contributions.service";
import { Public } from "../../common/guards/public.decorator";

// @Public() — no session of any kind exists for a public donor. See
// VaultContributionsService.initiate()'s own comment on why there's no
// ownership check the way ContributionsController has for a Founder.
@Public()
@Controller("vault-contributions")
export class VaultContributionsController {
  constructor(private readonly service: VaultContributionsService) {}

  @Post()
  initiate(@Body() body: InitiateVaultContributionInput) {
    return this.service.initiate(body);
  }

  // Polling target for the frontend after redirect/QR display — same
  // posture as GET /contributions/:id.
  @Get(":id")
  async findById(@Param("id") id: string) {
    const contribution = await this.service.findById(id);
    if (!contribution) throw new NotFoundException(`VaultContribution "${id}" not found.`);
    return contribution;
  }
}
