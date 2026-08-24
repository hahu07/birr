import { Module } from "@nestjs/common";
import { GovernedActionsService } from "./governed-actions.service";
import { GovernedActionsController } from "./governed-actions.controller";
import { AssetsModule } from "../assets/assets.module";
import { BeneficiariesModule } from "../beneficiaries/beneficiaries.module";
import { InvestmentsModule } from "../investments/investments.module";
import { DistributionsModule } from "../distributions/distributions.module";

@Module({
  imports: [
    AssetsModule,
    BeneficiariesModule,
    InvestmentsModule,
    DistributionsModule,
  ],
  controllers: [GovernedActionsController],
  providers: [GovernedActionsService],
  exports: [GovernedActionsService],
})
export class GovernedActionsModule {}
