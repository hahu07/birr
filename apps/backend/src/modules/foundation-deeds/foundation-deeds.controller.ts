import { Body, Controller, Get, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { IsBoolean, IsString } from "class-validator";
import type { Request } from "express";
import { FoundationDeedsService } from "./foundation-deeds.service";
import { isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

class SignFoundationDeedBody {
  @IsString()
  foundationId!: string;

  @IsString()
  typedLegalName!: string;

  @IsBoolean()
  affirmed!: boolean;
}

// @Public() — Founder-Portal self-service surface, same reasoning as
// FoundersController.
@Public()
@Controller("foundation-deeds")
export class FoundationDeedsController {
  constructor(private readonly service: FoundationDeedsService) {}

  // Restricted to the org's primary contact — a viewer/requester
  // colleague can reach everything else a Founder session offers, but
  // not this: it's the irrevocable act of appointing Birr as trustee,
  // and the deed's own typed-name check only means something if the
  // signer is guaranteed to be who they claim.
  @Post()
  async sign(@Body() body: SignFoundationDeedBody, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.sign({
      foundationId: body.foundationId,
      founderId: founder.id,
      typedLegalName: body.typedLegalName,
      affirmed: body.affirmed,
      ipAddress: request.ip,
    });
  }

  // A signed deed's deedText/typedLegalName/ipAddress is real legal and
  // personal content, not a public catalog — requires a real session of
  // *some* kind and scopes a Founder session to their own foundation,
  // same posture as WaqfDeedsController.findByWaqfId.
  @Get(":foundationId")
  async findByFoundationId(@Param("foundationId") foundationId: string, @Req() request: Request) {
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const deed = await this.service.findByFoundationIdForFounder(foundationId, founder.id);
      if (!deed) throw new NotFoundException(`No deed found for foundation "${foundationId}".`);
      return deed;
    }
    const deed = await this.service.findByFoundationId(foundationId);
    if (!deed) throw new NotFoundException(`No deed found for foundation "${foundationId}".`);
    return deed;
  }
}
