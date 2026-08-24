import { Module } from "@nestjs/common";
import { ContributionsService } from "./contributions.service";
import { ContributionsController } from "./contributions.controller";
import { AssetsModule } from "../assets/assets.module";
import { StripeAdapter } from "./providers/stripe.adapter";
import { PaystackAdapter } from "./providers/paystack.adapter";
import { StablecoinAdapter } from "./providers/stablecoin.adapter";
import { SettingsModule } from "../../common/settings/settings.module";

@Module({
  imports: [AssetsModule, SettingsModule],
  controllers: [ContributionsController],
  providers: [ContributionsService, StripeAdapter, PaystackAdapter, StablecoinAdapter],
  exports: [ContributionsService],
})
export class ContributionsModule {}
