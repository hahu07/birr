import { Module } from "@nestjs/common";
import { FoundersService } from "./founders.service";
import { FoundersController } from "./founders.controller";
import { ResendVerificationEmailAdapter } from "./email/resend.adapter";
import { TwilioWhatsAppAdapter } from "./whatsapp/twilio-whatsapp.adapter";
import { WhatsAppVerificationService } from "./whatsapp/whatsapp-verification.service";
import { LogoStorageService } from "../foundations/logo-storage.service";
import { SettingsModule } from "../../common/settings/settings.module";

@Module({
  imports: [SettingsModule],
  controllers: [FoundersController],
  providers: [
    FoundersService,
    ResendVerificationEmailAdapter,
    TwilioWhatsAppAdapter,
    WhatsAppVerificationService,
    LogoStorageService,
  ],
  exports: [FoundersService],
})
export class FoundersModule {}
