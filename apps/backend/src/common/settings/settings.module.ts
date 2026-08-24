import { Module } from "@nestjs/common";
import { EncryptionService } from "./encryption.service";
import { SettingsService } from "./settings.service";

@Module({
  providers: [EncryptionService, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
