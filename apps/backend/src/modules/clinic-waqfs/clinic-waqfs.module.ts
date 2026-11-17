import { Module } from "@nestjs/common";
import { ClinicWaqfsController } from "./clinic-waqfs.controller";
import { ClinicWaqfsService } from "./clinic-waqfs.service";
import { ClinicLedgerService } from "./clinic-ledger.service";

@Module({
  controllers: [ClinicWaqfsController],
  providers: [ClinicWaqfsService, ClinicLedgerService],
  exports: [ClinicWaqfsService, ClinicLedgerService],
})
export class ClinicWaqfsModule {}
