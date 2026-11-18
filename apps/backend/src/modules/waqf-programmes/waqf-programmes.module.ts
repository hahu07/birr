import { Module } from "@nestjs/common";
import { WaqfProgrammesController } from "./waqf-programmes.controller";
import { WaqfProgrammesService } from "./waqf-programmes.service";
import { ProgrammeLedgerService } from "./programme-ledger.service";
import { ProgrammeReportService } from "./programme-report.service";
import { ProgrammeGiftsController } from "./programme-gifts.controller";
import { ProgrammeGiftsService } from "./programme-gifts.service";
import { ProgrammeAssetsService } from "./programme-assets.service";
import { ProgrammeSpendingService } from "./programme-spending.service";
import { ProgrammeInvestmentsService } from "./programme-investments.service";
import { ProgrammeReserveService } from "./programme-reserve.service";
import { ResendProgrammeReceiptEmailAdapter } from "./programme-receipt-email.adapter";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { SettingsModule } from "../../common/settings/settings.module";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";
import { VaultsModule } from "../vaults/vaults.module";
import { RecurringGiftsCoreModule } from "../recurring-gifts/recurring-gifts-core.module";

// The general parts of a waqf programme (2026-11-17): the programme and its
// deed, pots and ledger, gifts, assets, spending, investments and reserve.
// A product's own parts are in its own module (ClinicsModule).
@Module({
  // VaultsModule: a programme gift's giver is a VaultDonor, checked by
  // VaultContributionsService.findOrCreateDonor (the shared AML threshold).
  // RecurringGiftsCoreModule: monthly programme gifts (clinic slice 4b).
  imports: [SettingsModule, WhatsAppOtpModule, VaultsModule, RecurringGiftsCoreModule],
  controllers: [WaqfProgrammesController, ProgrammeGiftsController],
  // PaystackAdapter: each consuming module provides its own instance, as VaultsModule and ZakahModule do.
  providers: [WaqfProgrammesService, ProgrammeLedgerService, ProgrammeGiftsService, ProgrammeAssetsService, ProgrammeSpendingService, ProgrammeInvestmentsService, ProgrammeReserveService, ProgrammeReportService, ResendProgrammeReceiptEmailAdapter, PaystackAdapter],
  exports: [WaqfProgrammesService, ProgrammeLedgerService, ProgrammeGiftsService, ProgrammeAssetsService, ProgrammeSpendingService, ProgrammeInvestmentsService, ProgrammeReserveService],
})
export class WaqfProgrammesModule {}
