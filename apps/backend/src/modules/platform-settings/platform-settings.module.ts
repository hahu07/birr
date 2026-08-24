import { Module } from "@nestjs/common";
import { PlatformSettingsController } from "./platform-settings.controller";
import { SettingsModule } from "../../common/settings/settings.module";

@Module({
  imports: [SettingsModule],
  controllers: [PlatformSettingsController],
})
export class PlatformSettingsModule {}
