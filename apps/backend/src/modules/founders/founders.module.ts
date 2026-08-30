import { Module } from "@nestjs/common";
import { FoundersService } from "./founders.service";
import { FoundersController } from "./founders.controller";
import { ResendVerificationEmailAdapter } from "./email/resend.adapter";
import { WhatsAppVerificationService } from "./whatsapp/whatsapp-verification.service";
import { LogoStorageService } from "../foundations/logo-storage.service";
import { SettingsModule } from "../../common/settings/settings.module";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";

@Module({
  imports: [SettingsModule, WhatsAppOtpModule],
  controllers: [FoundersController],
  providers: [FoundersService, ResendVerificationEmailAdapter, WhatsAppVerificationService, LogoStorageService],
  exports: [FoundersService],
})
export class FoundersModule {}
