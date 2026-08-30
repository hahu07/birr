import { Module } from "@nestjs/common";
import { BirrStaffService } from "./birr-staff.service";
import { BirrStaffController } from "./birr-staff.controller";
import { BirrStaffWhatsAppService } from "./whatsapp/birr-staff-whatsapp.service";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";

@Module({
  imports: [WhatsAppOtpModule],
  controllers: [BirrStaffController],
  providers: [BirrStaffService, BirrStaffWhatsAppService],
  exports: [BirrStaffService],
})
export class BirrStaffModule {}
