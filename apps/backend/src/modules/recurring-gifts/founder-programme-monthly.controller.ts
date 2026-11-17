import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../common/guards/public.decorator";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
import { AcceptProgrammeDeedInput, ChangeRecurringGiftAmountInput, RecurringGiftsService } from "./recurring-gifts.service";

/**
 * A Founder's monthly gifts to clinic waqfs (2026-11-17, clinic slice 4b),
 * in the Founder Portal's Clinic support page. Set up from a clinic's page
 * through POST /programme-gifts/founder with monthly: true. Any member of the
 * Founder can see them; only the primary contact can change them, as with
 * giving. @Public() like FounderMonthlyTopUpController: each route resolves
 * the Founder session itself.
 */
@Public()
@Controller("programme-gifts/founder/monthly")
export class FounderProgrammeMonthlyController {
  constructor(private readonly service: RecurringGiftsService) {}

  @Get()
  async list(@Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.founderProgrammeGifts(founder.id);
  }

  @Post(":giftId/amount")
  async changeAmount(@Param("giftId") giftId: string, @Body() body: ChangeRecurringGiftAmountInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.founderClinicChangeAmount(giftId, founder.id, body);
  }

  @Post(":giftId/cancel")
  async cancel(@Param("giftId") giftId: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.founderClinicCancel(giftId, founder.id);
  }

  @Post(":giftId/card")
  async updateCard(@Param("giftId") giftId: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.founderClinicCardUpdate(giftId, founder.id);
  }

  @Post(":giftId/deed")
  async acceptDeed(@Param("giftId") giftId: string, @Body() body: AcceptProgrammeDeedInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.founderClinicAcceptDeed(giftId, founder.id, body);
  }
}
