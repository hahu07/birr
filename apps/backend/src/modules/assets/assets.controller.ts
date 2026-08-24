import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { AssetsService, CreateAssetInput } from "./assets.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

@Controller("assets")
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  // No dispose route here, deliberately — asset.dispose is always a
  // governed_actions action (see AssetsService.dispose's comment). It's
  // only ever invoked internally, from GovernedActionsService.decide().

  @Post()
  create(@Body() body: CreateAssetInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, { actorType: "birr_staff", actorUserId: staff.userId });
  }

  @Get()
  list(@Query("waqfId") waqfId?: string) {
    return this.service.list(waqfId);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const asset = await this.service.findById(id);
    if (!asset) throw new NotFoundException(`Asset "${id}" not found.`);
    return asset;
  }
}
