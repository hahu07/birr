import { Module } from "@nestjs/common";
import { BeneficiaryNominationsService } from "./beneficiary-nominations.service";
import { BeneficiaryNominationsController } from "./beneficiary-nominations.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { EncryptionService } from "../../common/settings/encryption.service";

@Module({
  imports: [NotificationsModule],
  providers: [BeneficiaryNominationsService, EncryptionService],
  controllers: [BeneficiaryNominationsController],
})
export class BeneficiaryNominationsModule {}
