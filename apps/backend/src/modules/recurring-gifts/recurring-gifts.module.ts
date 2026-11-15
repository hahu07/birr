import { Module } from "@nestjs/common";
import { VaultsModule } from "../vaults/vaults.module";
import { RecurringGiftsCoreModule } from "./recurring-gifts-core.module";
import { RecurringGiftsService } from "./recurring-gifts.service";
import { VaultMonthlyProduct } from "./vault-monthly.product";
import { GivingManageController } from "./giving-manage.controller";

/** Monthly giving's schedule and the givers' own actions; see RecurringGiftsService. */
@Module({
  imports: [RecurringGiftsCoreModule, VaultsModule],
  controllers: [GivingManageController],
  providers: [RecurringGiftsService, VaultMonthlyProduct],
  exports: [RecurringGiftsService],
})
export class RecurringGiftsModule {}
