import { Module } from "@nestjs/common";
import { BirrStaffService } from "./birr-staff.service";
import { BirrStaffController } from "./birr-staff.controller";
import { BirrStaffWhatsAppService } from "./whatsapp/birr-staff-whatsapp.service";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";
import { EncryptionService } from "../../common/settings/encryption.service";
import { MfaService } from "../../common/auth/mfa.service";

@Module({
  imports: [WhatsAppOtpModule],
  controllers: [BirrStaffController],
  providers: [BirrStaffService, BirrStaffWhatsAppService, EncryptionService, MfaService],
  exports: [BirrStaffService],
})
export class BirrStaffModule {}
