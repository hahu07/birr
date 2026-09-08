import { Module } from "@nestjs/common";
import { BanksController } from "./banks.controller";
import { BanksService } from "./banks.service";
import { SettingsModule } from "../../common/settings/settings.module";

@Module({
  imports: [SettingsModule],
  controllers: [BanksController],
  providers: [BanksService],
})
export class BanksModule {}
