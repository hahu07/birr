import { Module } from "@nestjs/common";
import { VaultsModule } from "../vaults/vaults.module";
import { ContributionsModule } from "../contributions/contributions.module";
import { RecurringGiftsCoreModule } from "./recurring-gifts-core.module";
import { RecurringGiftsService } from "./recurring-gifts.service";
import { VaultMonthlyProduct } from "./vault-monthly.product";
import { WaqfMonthlyProduct } from "./waqf-monthly.product";
import { FounderMonthlyTopUpController } from "./founder-monthly-top-up.controller";
import { GivingManageController } from "./giving-manage.controller";

/** Monthly giving's schedule and the givers' own actions; see RecurringGiftsService. */
@Module({
  imports: [RecurringGiftsCoreModule, VaultsModule, ContributionsModule],
  controllers: [GivingManageController, FounderMonthlyTopUpController],
  providers: [RecurringGiftsService, VaultMonthlyProduct, WaqfMonthlyProduct],
  exports: [RecurringGiftsService],
})
export class RecurringGiftsModule {}
