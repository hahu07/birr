import { Module } from "@nestjs/common";
import { GovernedActionsService } from "./governed-actions.service";
import { GovernedActionsController } from "./governed-actions.controller";
import { AssetsModule } from "../assets/assets.module";
import { BeneficiariesModule } from "../beneficiaries/beneficiaries.module";
import { InvestmentsModule } from "../investments/investments.module";
import { CounterpartiesModule } from "../counterparties/counterparties.module";
import { DistributionsModule } from "../distributions/distributions.module";
import { VaultsModule } from "../vaults/vaults.module";
import { WaqfLedgerModule } from "../waqf-ledger/waqf-ledger.module";
import { BlogModule } from "../blog/blog.module";
import { BirrStaffModule } from "../birr-staff/birr-staff.module";
import { FoundersModule } from "../founders/founders.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    AssetsModule,
    BeneficiariesModule,
    InvestmentsModule,
    CounterpartiesModule,
    DistributionsModule,
    VaultsModule,
    BlogModule,
    BirrStaffModule,
    FoundersModule,
    WaqfLedgerModule,
    NotificationsModule,
  ],
  controllers: [GovernedActionsController],
  providers: [GovernedActionsService],
  exports: [GovernedActionsService],
})
export class GovernedActionsModule {}
