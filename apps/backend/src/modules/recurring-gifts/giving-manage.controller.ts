import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/guards/public.decorator";
import { VaultDonorIdentityInput } from "../vaults/vault-contributions.service";
import { ChangeRecurringGiftAmountInput, RecurringGiftsService, RequestManageLinksInput } from "./recurring-gifts.service";

/**
 * A Vault or zakah giver managing their monthly gift. No account: the
 * private link's token is the credential (only its hash is stored; see
 * RecurringGift.manageTokenHash). Throttled like the giving routes.
 */
@Controller("giving")
export class GivingManageController {
  constructor(private readonly service: RecurringGiftsService) {}

  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Public()
  @Post("manage-links")
  requestLinks(@Body() body: RequestManageLinksInput) {
    return this.service.requestManageLinks(body);
  }

  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Public()
  @Get("manage/:token")
  view(@Param("token") token: string) {
    return this.service.view(token);
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @Post("manage/:token/amount")
  changeAmount(@Param("token") token: string, @Body() body: ChangeRecurringGiftAmountInput) {
    return this.service.changeAmount(token, body);
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @Post("manage/:token/cancel")
  cancel(@Param("token") token: string) {
    return this.service.cancel(token);
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @Post("manage/:token/card")
  updateCard(@Param("token") token: string) {
    return this.service.startCardUpdate(token);
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @Post("manage/:token/identity")
  identity(@Param("token") token: string, @Body() body: VaultDonorIdentityInput) {
    return this.service.provideIdentity(token, body);
  }
}
