import { Module } from "@nestjs/common";
import { ClinicWaqfsController } from "./clinic-waqfs.controller";
import { ClinicWaqfsService } from "./clinic-waqfs.service";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { ClinicGiftsController } from "./clinic-gifts.controller";
import { ClinicGiftsService } from "./clinic-gifts.service";
import { ResendClinicReceiptEmailAdapter } from "./clinic-receipt-email.adapter";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { SettingsModule } from "../../common/settings/settings.module";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";
import { VaultsModule } from "../vaults/vaults.module";
import { RecurringGiftsCoreModule } from "../recurring-gifts/recurring-gifts-core.module";

@Module({
  // VaultsModule: a clinic gift's giver is a VaultDonor, checked by
  // VaultContributionsService.findOrCreateDonor (the shared AML threshold).
  // RecurringGiftsCoreModule: monthly clinic gifts (slice 4b).
  imports: [SettingsModule, WhatsAppOtpModule, VaultsModule, RecurringGiftsCoreModule],
  controllers: [ClinicWaqfsController, ClinicGiftsController],
  // PaystackAdapter: each consuming module provides its own instance, as VaultsModule and ZakahModule do.
  providers: [ClinicWaqfsService, ClinicLedgerService, ClinicGiftsService, ResendClinicReceiptEmailAdapter, PaystackAdapter],
  exports: [ClinicWaqfsService, ClinicLedgerService, ClinicGiftsService],
})
export class ClinicWaqfsModule {}
