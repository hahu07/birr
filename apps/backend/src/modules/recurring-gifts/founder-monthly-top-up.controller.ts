import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../common/guards/public.decorator";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
import { ChangeRecurringGiftAmountInput, RecurringGiftsService } from "./recurring-gifts.service";

/**
 * A founder's monthly top-up to one of their own Waqf Funds, in the
 * Founder Portal. Set up through POST /contributions with monthly: true.
 * Any member of the Founder can see it; only the primary contact can
 * change it, as with making a contribution.
 */
@Public()
@Controller("waqfs/:waqfId/monthly-top-up")
export class FounderMonthlyTopUpController {
  constructor(private readonly service: RecurringGiftsService) {}

  @Get()
  async view(@Param("waqfId") waqfId: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.founderTopUp(waqfId, founder.id);
  }

  @Post("amount")
  async changeAmount(@Param("waqfId") waqfId: string, @Body() body: ChangeRecurringGiftAmountInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.founderChangeAmount(waqfId, founder.id, body);
  }

  @Post("cancel")
  async cancel(@Param("waqfId") waqfId: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.founderCancel(waqfId, founder.id);
  }

  @Post("card")
  async updateCard(@Param("waqfId") waqfId: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.founderCardUpdate(waqfId, founder.id);
  }
}
