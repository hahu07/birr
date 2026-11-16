import { Module } from "@nestjs/common";
import { TwilioWhatsAppAdapter } from "./twilio-whatsapp.adapter";
import { WhatsAppOtpService } from "./whatsapp-otp.service";
import { GiverWhatsAppService } from "./giver-whatsapp.service";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [SettingsModule],
  providers: [TwilioWhatsAppAdapter, WhatsAppOtpService, GiverWhatsAppService],
  // TwilioWhatsAppAdapter also exported directly — NotificationsService
  // needs it for arbitrary notification messages, not just OTP codes,
  // and this keeps it a true shared singleton (one client cache) rather
  // than each importing module standing up its own instance.
  exports: [WhatsAppOtpService, TwilioWhatsAppAdapter, GiverWhatsAppService],
})
export class WhatsAppOtpModule {}
