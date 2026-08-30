import { Module } from "@nestjs/common";
import { GovernedActionsService } from "./governed-actions.service";
import { GovernedActionsController } from "./governed-actions.controller";
import { AssetsModule } from "../assets/assets.module";
import { BeneficiariesModule } from "../beneficiaries/beneficiaries.module";
import { InvestmentsModule } from "../investments/investments.module";
import { CounterpartiesModule } from "../counterparties/counterparties.module";
import { DistributionsModule } from "../distributions/distributions.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    AssetsModule,
    BeneficiariesModule,
    InvestmentsModule,
    CounterpartiesModule,
    DistributionsModule,
    NotificationsModule,
  ],
  controllers: [GovernedActionsController],
  providers: [GovernedActionsService],
  exports: [GovernedActionsService],
})
export class GovernedActionsModule {}
