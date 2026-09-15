import { Module } from "@nestjs/common";
import { DistributionsService } from "./distributions.service";
import { DistributionsController } from "./distributions.controller";
import { BeneficiariesModule } from "../beneficiaries/beneficiaries.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../../common/settings/settings.module";
import { WaqfLedgerModule } from "../waqf-ledger/waqf-ledger.module";
import { PaystackPayoutAdapter } from "./providers/paystack-payout.adapter";
import { StripePayoutAdapter } from "./providers/stripe-payout.adapter";
import { StablecoinPayoutAdapter } from "./providers/stablecoin-payout.adapter";

@Module({
  imports: [BeneficiariesModule, NotificationsModule, SettingsModule, WaqfLedgerModule],
  controllers: [DistributionsController],
  providers: [DistributionsService, PaystackPayoutAdapter, StripePayoutAdapter, StablecoinPayoutAdapter],
  exports: [DistributionsService],
})
export class DistributionsModule {}
