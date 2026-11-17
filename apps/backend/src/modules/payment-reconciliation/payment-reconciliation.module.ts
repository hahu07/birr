import { Module } from "@nestjs/common";
import { SettingsModule } from "../../common/settings/settings.module";
import { PaystackReportsClient } from "../../common/payments/paystack-reports.client";
import { NotificationsModule } from "../notifications/notifications.module";
import { ContributionsModule } from "../contributions/contributions.module";
import { VaultsModule } from "../vaults/vaults.module";
import { ZakahModule } from "../zakah/zakah.module";
import { ClinicWaqfsModule } from "../clinic-waqfs/clinic-waqfs.module";
import { PaymentReconciliationService } from "./payment-reconciliation.service";
import { PaymentReconciliationController } from "./payment-reconciliation.controller";

/** Daily Paystack reconciliation; see PaymentReconciliationService. */
@Module({
  imports: [SettingsModule, NotificationsModule, ContributionsModule, VaultsModule, ZakahModule, ClinicWaqfsModule],
  controllers: [PaymentReconciliationController],
  providers: [PaymentReconciliationService, PaystackReportsClient],
  exports: [PaymentReconciliationService],
})
export class PaymentReconciliationModule {}
