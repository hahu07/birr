import { Module } from "@nestjs/common";
import { ZakahController } from "./zakah.controller";
import { ZakahService } from "./zakah.service";
import { ZakahPaymentsController } from "./zakah-payments.controller";
import { ZakahPaymentsService } from "./zakah-payments.service";
import { ZakahLedgerService } from "./zakah-ledger.service";
import { ZakahDistributionsController } from "./zakah-distributions.controller";
import { ZakahDistributionsService } from "./zakah-distributions.service";
import { ResendZakahReceiptEmailAdapter } from "./zakah-receipt-email.adapter";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { SettingsModule } from "../../common/settings/settings.module";
import { EncryptionService } from "../../common/settings/encryption.service";

@Module({
  imports: [SettingsModule],
  controllers: [ZakahController, ZakahPaymentsController, ZakahDistributionsController],
  // PaystackAdapter and EncryptionService: each consuming module provides
  // its own instance, same convention as VaultsModule.
  providers: [ZakahService, ZakahPaymentsService, ZakahDistributionsService, ZakahLedgerService, ResendZakahReceiptEmailAdapter, PaystackAdapter, EncryptionService],
  exports: [ZakahService, ZakahPaymentsService, ZakahDistributionsService],
})
export class ZakahModule {}
