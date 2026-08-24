import { Module } from "@nestjs/common";
import { WaqfCaseAssignmentsService } from "./waqf-case-assignments.service";
import { WaqfCaseAssignmentsController } from "./waqf-case-assignments.controller";

@Module({
  controllers: [WaqfCaseAssignmentsController],
  providers: [WaqfCaseAssignmentsService],
  exports: [WaqfCaseAssignmentsService],
})
export class WaqfCaseAssignmentsModule {}
