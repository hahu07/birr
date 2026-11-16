import { Module } from "@nestjs/common";
import { SettingsModule } from "../../common/settings/settings.module";
import { EncryptionService } from "../../common/settings/encryption.service";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { RecurringGiftsCoreService } from "./recurring-gifts-core.service";
import { ResendRecurringGiftEmailAdapter } from "./email/resend-recurring-gift-email.adapter";

/** What the product modules (Vault, waqf contributions, zakah) need for monthly giving; see RecurringGiftsCoreService. */
@Module({
  imports: [SettingsModule],
  // PaystackAdapter and EncryptionService: each consuming module provides its own, as VaultsModule does.
  providers: [RecurringGiftsCoreService, ResendRecurringGiftEmailAdapter, PaystackAdapter, EncryptionService],
  exports: [RecurringGiftsCoreService, ResendRecurringGiftEmailAdapter],
})
export class RecurringGiftsCoreModule {}
