import { Controller, Get, Param, Query } from "@nestjs/common";
import { VaultLedgerService } from "./vault-ledger.service";

// Read-only reports over VaultJournalEntry/VaultJournalEntryLine — no
// @Public(), staff-only informational views, no role restriction beyond
// an authenticated staff session (same posture as VaultDistributionsController.list()).
@Controller("vaults")
export class VaultLedgerController {
  constructor(private readonly ledger: VaultLedgerService) {}

  @Get(":id/ledger/trial-balance")
  trialBalance(@Param("id") id: string, @Query("currency") currency: string) {
    return this.ledger.trialBalance(id, currency);
  }

  @Get(":id/ledger/income-statement")
  incomeStatement(@Param("id") id: string, @Query("currency") currency: string) {
    return this.ledger.incomeStatement(id, currency);
  }
}
