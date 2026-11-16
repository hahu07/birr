import { Module } from "@nestjs/common";
import { VaultsModule } from "../vaults/vaults.module";
import { ContributionsModule } from "../contributions/contributions.module";
import { ZakahModule } from "../zakah/zakah.module";
import { RecurringGiftsCoreModule } from "./recurring-gifts-core.module";
import { RecurringGiftsService } from "./recurring-gifts.service";
import { VaultMonthlyProduct } from "./vault-monthly.product";
import { WaqfMonthlyProduct } from "./waqf-monthly.product";
import { ZakahMonthlyProduct } from "./zakah-monthly.product";
import { FounderMonthlyTopUpController } from "./founder-monthly-top-up.controller";
import { RecurringGiftsStaffController } from "./recurring-gifts-staff.controller";
import { GivingManageController } from "./giving-manage.controller";
import { GivingWhatsAppController } from "./giving-whatsapp.controller";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";

/** Monthly giving's schedule and the givers' own actions; see RecurringGiftsService. */
@Module({
  imports: [RecurringGiftsCoreModule, VaultsModule, ContributionsModule, ZakahModule, WhatsAppOtpModule],
  controllers: [GivingManageController, GivingWhatsAppController, FounderMonthlyTopUpController, RecurringGiftsStaffController],
  providers: [RecurringGiftsService, VaultMonthlyProduct, WaqfMonthlyProduct, ZakahMonthlyProduct],
  exports: [RecurringGiftsService],
})
export class RecurringGiftsModule {}
