import { Module } from "@nestjs/common";
import { VaultsService } from "./vaults.service";
import { VaultsController } from "./vaults.controller";
import { VaultCoverStorageService } from "./vault-cover-storage.service";
import { VaultContributionsService } from "./vault-contributions.service";
import { VaultContributionsController } from "./vault-contributions.controller";
import { VaultInvestmentsService } from "./vault-investments.service";
import { VaultInvestmentsController } from "./vault-investments.controller";
import { VaultProceedsService } from "./vault-proceeds.service";
import { VaultProceedsController } from "./vault-proceeds.controller";
import { VaultDistributionsService } from "./vault-distributions.service";
import { VaultDistributionsController } from "./vault-distributions.controller";
import { VaultDonorThresholdsService } from "./vault-donor-thresholds.service";
import { VaultDonorThresholdsController } from "./vault-donor-thresholds.controller";
import { VaultLedgerService } from "./vault-ledger.service";
import { VaultLedgerController } from "./vault-ledger.controller";
import { VaultLedgerAccountsService } from "./vault-ledger-accounts.service";
import { VaultLedgerAccountsController } from "./vault-ledger-accounts.controller";
import { VaultExpensesService } from "./vault-expenses.service";
import { VaultExpensesController } from "./vault-expenses.controller";
import { VaultMilestonesService } from "./vault-milestones.service";
import { VaultMilestonesController } from "./vault-milestones.controller";
import { ResendVaultReceiptEmailAdapter } from "./email/resend-vault-receipt.adapter";
import { StripeAdapter } from "../contributions/providers/stripe.adapter";
import { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { StablecoinAdapter } from "../contributions/providers/stablecoin.adapter";
import { PaystackPayoutAdapter } from "../distributions/providers/paystack-payout.adapter";
import { SettingsModule } from "../../common/settings/settings.module";
import { EncryptionService } from "../../common/settings/encryption.service";

@Module({
  imports: [SettingsModule],
  controllers: [
    VaultsController,
    VaultContributionsController,
    VaultInvestmentsController,
    VaultProceedsController,
    VaultDistributionsController,
    VaultDonorThresholdsController,
    VaultLedgerController,
    VaultLedgerAccountsController,
    VaultExpensesController,
    VaultMilestonesController,
  ],
  providers: [
    VaultsService,
    VaultCoverStorageService,
    VaultDonorThresholdsService,
    VaultContributionsService,
    VaultInvestmentsService,
    VaultProceedsService,
    VaultDistributionsService,
    VaultLedgerService,
    VaultLedgerAccountsService,
    VaultExpensesService,
    VaultMilestonesService,
    // Not exported by SettingsModule (only SettingsService is) — every
    // consuming module provides its own instance, same convention as
    // e.g. BeneficiariesModule's own EncryptionService provider.
    EncryptionService,
    ResendVaultReceiptEmailAdapter,
    StripeAdapter,
    PaystackAdapter,
    StablecoinAdapter,
    PaystackPayoutAdapter,
  ],
  exports: [
    VaultsService,
    VaultContributionsService,
    VaultInvestmentsService,
    VaultProceedsService,
    VaultDistributionsService,
    VaultMilestonesService,
  ],
})
export class VaultsModule {}
