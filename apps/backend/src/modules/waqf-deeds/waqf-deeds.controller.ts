import { Body, Controller, Get, NotFoundException, Param, Post, Req } from "@nestjs/common";
import { IsBoolean, IsString } from "class-validator";
import type { Request } from "express";
import { WaqfDeedsService } from "./waqf-deeds.service";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { Public } from "../../common/guards/public.decorator";

class SignDeedBody {
  @IsString()
  waqfId!: string;

  @IsString()
  typedLegalName!: string;

  @IsBoolean()
  affirmed!: boolean;
}

// @Public() — Founder-Portal self-service surface, same reasoning as
// FoundersController.
@Public()
@Controller("waqf-deeds")
export class WaqfDeedsController {
  constructor(private readonly service: WaqfDeedsService) {}

  @Post()
  async sign(@Body() body: SignDeedBody, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.sign({
      waqfId: body.waqfId,
      founderId: founder.id,
      typedLegalName: body.typedLegalName,
      affirmed: body.affirmed,
      ipAddress: request.ip,
    });
  }

  @Get(":waqfId")
  async findByWaqfId(@Param("waqfId") waqfId: string) {
    const deed = await this.service.findByWaqfId(waqfId);
    if (!deed) throw new NotFoundException(`No deed found for waqf "${waqfId}".`);
    return deed;
  }
}
