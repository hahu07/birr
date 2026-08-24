import { Module } from "@nestjs/common";
import { AiAgentsService } from "./ai-agents.service";
import { AiAgentsController } from "./ai-agents.controller";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";

@Module({
  imports: [AuditLogsModule],
  controllers: [AiAgentsController],
  providers: [AiAgentsService],
  exports: [AiAgentsService],
})
export class AiAgentsModule {}
