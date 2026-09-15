import { Module } from "@nestjs/common";
import { WaqfLedgerService } from "./waqf-ledger.service";
import { WaqfLedgerController } from "./waqf-ledger.controller";
import { WaqfLedgerAccountsService } from "./waqf-ledger-accounts.service";
import { WaqfLedgerAccountsController } from "./waqf-ledger-accounts.controller";
import { WaqfExpensesService } from "./waqf-expenses.service";
import { WaqfExpensesController } from "./waqf-expenses.controller";
import { WaqfMilestonesService } from "./waqf-milestones.service";
import { WaqfMilestonesController } from "./waqf-milestones.controller";
import { WaqfMilestoneEvidenceStorageService } from "./waqf-milestone-evidence-storage.service";

// Founder/Waqf-side counterpart to VaultsModule's own ledger/expense/
// milestone slice — a separate module (not folded into WaqfsModule)
// since DistributionsModule and ContributionsModule both need
// WaqfLedgerService without pulling in the rest of WaqfsModule's own
// dependency graph.
@Module({
  controllers: [WaqfLedgerController, WaqfLedgerAccountsController, WaqfExpensesController, WaqfMilestonesController],
  providers: [WaqfLedgerService, WaqfLedgerAccountsService, WaqfExpensesService, WaqfMilestonesService, WaqfMilestoneEvidenceStorageService],
  exports: [WaqfLedgerService, WaqfMilestonesService],
})
export class WaqfLedgerModule {}
