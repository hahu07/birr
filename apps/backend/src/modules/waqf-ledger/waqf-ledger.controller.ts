import { Controller, Get, Param, Query } from "@nestjs/common";
import { WaqfLedgerService } from "./waqf-ledger.service";

// Read-only reports over WaqfJournalEntry/WaqfJournalEntryLine — no
// @Public(), staff-only informational views, mirrors VaultLedgerController exactly.
@Controller("waqfs")
export class WaqfLedgerController {
  constructor(private readonly ledger: WaqfLedgerService) {}

  @Get(":id/ledger/trial-balance")
  trialBalance(@Param("id") id: string, @Query("currency") currency: string) {
    return this.ledger.trialBalance(id, currency);
  }

  @Get(":id/ledger/income-statement")
  incomeStatement(@Param("id") id: string, @Query("currency") currency: string) {
    return this.ledger.incomeStatement(id, currency);
  }
}
