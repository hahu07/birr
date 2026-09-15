import { Module } from "@nestjs/common";
import { CounterpartiesService } from "./counterparties.service";
import { CounterpartiesController } from "./counterparties.controller";
import { SanctionsScreeningService } from "./sanctions-screening.service";
import { ScreenShieldAdapter } from "./providers/screenshield.adapter";
import { EncryptionService } from "../../common/settings/encryption.service";
import { SettingsModule } from "../../common/settings/settings.module";

@Module({
  imports: [SettingsModule],
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService, SanctionsScreeningService, ScreenShieldAdapter, EncryptionService],
  exports: [CounterpartiesService, SanctionsScreeningService],
})
export class CounterpartiesModule {}
