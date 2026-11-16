import { Module } from "@nestjs/common";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";
import { ZakahController } from "./zakah.controller";
import { ZakahService } from "./zakah.service";
import { ZakahPaymentsController } from "./zakah-payments.controller";
import { ZakahPaymentsService } from "./zakah-payments.service";
import { ZakahLedgerService } from "./zakah-ledger.service";
import { ZakahDistributionsController } from "./zakah-distributions.controller";
import { ZakahDistributionsService } from "./zakah-distributions.service";
import { ZakahRefundsController } from "./zakah-refunds.controller";
import { ZakahRefundsService } from "./zakah-refunds.service";
import { ZakahFitrService } from "./zakah-fitr.service";
import { ZakahStructuringReviewService } from "./zakah-structuring-review.service";
import { ResendZakahReceiptEmailAdapter } from "./zakah-receipt-email.adapter";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { SettingsModule } from "../../common/settings/settings.module";
import { RecurringGiftsCoreModule } from "../recurring-gifts/recurring-gifts-core.module";
import { EncryptionService } from "../../common/settings/encryption.service";

@Module({
  imports: [SettingsModule, RecurringGiftsCoreModule, WhatsAppOtpModule],
  controllers: [ZakahController, ZakahPaymentsController, ZakahDistributionsController, ZakahRefundsController],
  // PaystackAdapter and EncryptionService: each consuming module provides
  // its own instance, same convention as VaultsModule.
  providers: [ZakahService, ZakahFitrService, ZakahStructuringReviewService, ZakahPaymentsService, ZakahDistributionsService, ZakahRefundsService, ZakahLedgerService, ResendZakahReceiptEmailAdapter, PaystackAdapter, EncryptionService],
  exports: [ZakahService, ZakahFitrService, ZakahPaymentsService, ZakahDistributionsService, ZakahRefundsService],
})
export class ZakahModule {}
