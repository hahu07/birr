import { Module } from "@nestjs/common";
import { ContributionsService } from "./contributions.service";
import { ContributionsController } from "./contributions.controller";
import { AssetsModule } from "../assets/assets.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { DistributionsModule } from "../distributions/distributions.module";
import { StripeAdapter } from "./providers/stripe.adapter";
import { PaystackAdapter } from "./providers/paystack.adapter";
import { StablecoinAdapter } from "./providers/stablecoin.adapter";
import { SettingsModule } from "../../common/settings/settings.module";

// DistributionsModule import is only for its webhook dispatch — the
// payout webhook needs to be tried from the same POST /webhooks/paystack
// route ContributionsController already owns, since Paystack only
// supports one webhook URL per account (see that controller's own
// comment). A dedicated shared WebhooksModule would be the cleaner
// long-term shape if a third payout-adjacent consumer ever shows up;
// not worth the bigger diff for two consumers.
@Module({
  imports: [AssetsModule, NotificationsModule, DistributionsModule, SettingsModule],
  controllers: [ContributionsController],
  providers: [ContributionsService, StripeAdapter, PaystackAdapter, StablecoinAdapter],
  exports: [ContributionsService],
})
export class ContributionsModule {}
