import { Body, Controller, Get, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { IsBoolean, IsString } from "class-validator";
import type { Request } from "express";
import { FoundationDeedsService } from "./foundation-deeds.service";
import { isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { assertPrimaryContact, resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

class SignFoundationDeedBody {
  @IsString()
  foundationId!: string;

  @IsString()
  typedLegalName!: string;

  @IsBoolean()
  affirmed!: boolean;

  // From GET :foundationId/preview — proves the signer saw the text stored.
  @IsString()
  textHash!: string;
}

class GiveConsentBody {
  // From GET :foundationId/consent — proves they saw the statement stored.
  @IsString()
  statementHash!: string;
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
      textHash: body.textHash,
      ipAddress: request.ip,
    });
  }

  // The full deed text as it would be signed now. Declared before
  // :foundationId so "preview" is never read as an id. Founder-only:
  // staff read signed deeds below, and have nothing to sign.
  @Get(":foundationId/preview")
  async preview(@Param("foundationId") foundationId: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.preview(foundationId, founder.id);
  }

  // A co-founder's own agreement to the deed, when none is on record yet
  // (see FoundationDeedsService.consentStatus). Null when none is needed.
  @Get(":foundationId/consent")
  async consentStatus(@Param("foundationId") foundationId: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.consentStatus(foundationId, founder.id);
  }

  // The signer asks Birr to remind the co-founders the deed is waiting
  // for (at most once a day each). Primary contact only, like signing.
  @Post(":foundationId/consent-reminders")
  async remindCoFounders(@Param("foundationId") foundationId: string, @Req() request: Request) {
    const [user, founder] = await Promise.all([resolveUserFromSession(request), resolveFounderFromSession(request)]);
    assertPrimaryContact(founder);
    return this.service.remindAwaitingCoFounders(foundationId, founder.id, user.fullName);
  }

  // Agreeing binds this founder (their money is dedicated under the
  // deed), so like signing it's for their primary contact only.
  @Post(":foundationId/consent")
  async giveConsent(@Param("foundationId") foundationId: string, @Body() body: GiveConsentBody, @Req() request: Request) {
    const [user, founder] = await Promise.all([resolveUserFromSession(request), resolveFounderFromSession(request)]);
    assertPrimaryContact(founder);
    return this.service.giveConsent({ foundationId, founderId: founder.id, userId: user.id, statementHash: body.statementHash, ipAddress: request.ip });
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
