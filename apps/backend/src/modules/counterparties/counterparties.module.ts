import { Module } from "@nestjs/common";
import { CounterpartiesService } from "./counterparties.service";
import { CounterpartiesController } from "./counterparties.controller";
import { EncryptionService } from "../../common/settings/encryption.service";

@Module({
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService, EncryptionService],
  exports: [CounterpartiesService],
})
export class CounterpartiesModule {}
