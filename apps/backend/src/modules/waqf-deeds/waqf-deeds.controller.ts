import { Controller, Get, NotFoundException, Param, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { WaqfDeedsService } from "./waqf-deeds.service";
import { isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

// @Public() — Founder-Portal self-service surface, same reasoning as
// FoundersController. Signing (POST) is retired — deed-signing is now
// Foundation-level, see FoundationDeedsController — this controller
// only serves any historical per-Waqf WaqfDeed row that already exists.
@Public()
@Controller("waqf-deeds")
export class WaqfDeedsController {
  constructor(private readonly service: WaqfDeedsService) {}

  // A signed deed's deedText/typedLegalName/ipAddress is real legal and
  // personal content, not a public catalog like CauseCategory — unlike
  // this controller's other @Public() route (accessible pre-session by
  // design, since signing IS the auth check), this one requires a real
  // session of *some* kind and scopes a Founder session to their own
  // waqf. Fixes a real gap: this route previously returned any waqf's
  // full deed to anyone who knew or guessed its id, with no session
  // check at all.
  @Get(":waqfId")
  async findByWaqfId(@Param("waqfId") waqfId: string, @Req() request: Request) {
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const deed = await this.service.findByWaqfIdForFounder(waqfId, founder.id);
      if (!deed) throw new NotFoundException(`No deed found for waqf "${waqfId}".`);
      return deed;
    }
    const deed = await this.service.findByWaqfId(waqfId);
    if (!deed) throw new NotFoundException(`No deed found for waqf "${waqfId}".`);
    return deed;
  }
}
