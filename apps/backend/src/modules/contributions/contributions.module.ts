import { Module } from "@nestjs/common";
import { ContributionsService } from "./contributions.service";
import { ContributionsController } from "./contributions.controller";
import { AssetsModule } from "../assets/assets.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { DistributionsModule } from "../distributions/distributions.module";
import { VaultsModule } from "../vaults/vaults.module";
import { WaqfLedgerModule } from "../waqf-ledger/waqf-ledger.module";
import { StripeAdapter } from "./providers/stripe.adapter";
import { PaystackAdapter } from "./providers/paystack.adapter";
import { StablecoinAdapter } from "./providers/stablecoin.adapter";
import { SettingsModule } from "../../common/settings/settings.module";

// DistributionsModule/VaultsModule imports are only for their own
// webhook dispatch — both need to be tried from the same
// POST /webhooks/{stripe,paystack,stablecoin} routes ContributionsController
// already owns (Paystack specifically only supports one webhook URL per
// account — see that controller's own comment). A dedicated shared
// WebhooksModule would be the cleaner long-term shape if a fourth
// payout/contribution-adjacent consumer ever shows up; not worth the
// bigger diff for three.
@Module({
  imports: [AssetsModule, NotificationsModule, DistributionsModule, VaultsModule, SettingsModule, WaqfLedgerModule],
  controllers: [ContributionsController],
  providers: [ContributionsService, StripeAdapter, PaystackAdapter, StablecoinAdapter],
  exports: [ContributionsService],
})
export class ContributionsModule {}
