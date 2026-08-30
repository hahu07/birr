import { Module } from "@nestjs/common";
import { BeneficiariesService } from "./beneficiaries.service";
import { BeneficiariesController } from "./beneficiaries.controller";
import { EncryptionService } from "../../common/settings/encryption.service";

@Module({
  controllers: [BeneficiariesController],
  providers: [BeneficiariesService, EncryptionService],
  exports: [BeneficiariesService],
})
export class BeneficiariesModule {}
