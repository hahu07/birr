import { Module } from "@nestjs/common";
import { CounterpartiesService } from "./counterparties.service";
import { CounterpartiesController } from "./counterparties.controller";
import { CounterpartyLicensesService } from "./counterparty-licenses.service";
import { EncryptionService } from "../../common/settings/encryption.service";

@Module({
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService, CounterpartyLicensesService, EncryptionService],
  exports: [CounterpartiesService, CounterpartyLicensesService],
})
export class CounterpartiesModule {}
