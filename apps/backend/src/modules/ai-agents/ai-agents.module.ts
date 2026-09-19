import { Module } from "@nestjs/common";
import { AiAgentsService } from "./ai-agents.service";
import { AiAgentsController } from "./ai-agents.controller";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";
import { SettingsModule } from "../../common/settings/settings.module";
import { InvestmentsModule } from "../investments/investments.module";
import { VaultsModule } from "../vaults/vaults.module";
import { BeneficiariesModule } from "../beneficiaries/beneficiaries.module";
import { ImageGenerationService } from "./image-generation.service";
import { GeneratedImageStorageService } from "./generated-image-storage.service";
import { OpenAiImageAdapter } from "./image-providers/openai-image.adapter";
import { ReplicateImageAdapter } from "./image-providers/replicate-image.adapter";

@Module({
  imports: [AuditLogsModule, SettingsModule, InvestmentsModule, VaultsModule, BeneficiariesModule],
  controllers: [AiAgentsController],
  providers: [AiAgentsService, ImageGenerationService, GeneratedImageStorageService, OpenAiImageAdapter, ReplicateImageAdapter],
  exports: [AiAgentsService],
})
export class AiAgentsModule {}
