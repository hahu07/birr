import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { IsString } from "class-validator";
import { AiAgentsService, DraftInput } from "./ai-agents.service";
import { ImageGenerationService } from "./image-generation.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { verifyAiAgentApiKey } from "../../common/auth/ai-agent-auth";
import { Public } from "../../common/guards/public.decorator";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

class GenerateImageInput {
  @IsString()
  prompt!: string;
}

@Controller("ai-agents")
export class AiAgentsController {
  constructor(
    private readonly service: AiAgentsService,
    private readonly imageGeneration: ImageGenerationService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  // BirrStaff-session-authenticated (no @Public()) — unlike the three
  // agent-authenticated routes below, this is the Ops Console's own
  // read, keyed by the AiAgent row's id rather than its registry name to
  // keep it visibly distinct from those.
  @Get(":id/drafts")
  drafts(@Param("id") id: string) {
    return this.service.drafts(id);
  }

  // @Public() — these three routes are agent-authenticated, not
  // BirrStaff-session-authenticated. Each independently verifies
  // x-agent-api-key against the named agent's own row before doing
  // anything, same "@Public() because it's authenticated a different
  // way" pattern already used for Founder-session routes. Deliberately
  // NOT reusing the staff-facing governed-actions/case-assignments
  // endpoints or a dual-identity guard — see this phase's plan for why.
  @Get(":name/jurisdiction-data")
  @Public()
  async jurisdictionData(@Param("name") name: string, @Headers("x-agent-api-key") apiKey?: string) {
    await verifyAiAgentApiKey(name, apiKey);
    return this.service.jurisdictionData();
  }

  @Get(":name/case-digest-data")
  @Public()
  async caseDigestData(@Param("name") name: string, @Headers("x-agent-api-key") apiKey?: string) {
    await verifyAiAgentApiKey(name, apiKey);
    return this.service.caseDigestData();
  }

  @Get(":name/portfolio-data")
  @Public()
  async portfolioData(@Param("name") name: string, @Headers("x-agent-api-key") apiKey?: string) {
    await verifyAiAgentApiKey(name, apiKey);
    return this.service.portfolioData();
  }

  // Munsif's own domain (Beneficiary) is genuinely PII-bearing, unlike
  // the three GET routes above — see AiAgentsService
  // .beneficiaryVerificationData()'s own comment for why this never
  // returns a name/phone/email/bank detail.
  @Get(":name/beneficiary-verification-data")
  @Public()
  async beneficiaryVerificationData(@Param("name") name: string, @Headers("x-agent-api-key") apiKey?: string) {
    await verifyAiAgentApiKey(name, apiKey);
    return this.service.beneficiaryVerificationData();
  }

  // Agent-authenticated, same shape as the two GET routes above — a
  // cost-incurring external API call, so worth its own audit trail
  // entry (action: "image.generated") for the same reason every other
  // meaningful action here gets one, even though this route itself
  // never touches governed_actions.
  @Post(":name/generate-image")
  @Public()
  async generateImage(
    @Param("name") name: string,
    @Body() body: GenerateImageInput,
    @Headers("x-agent-api-key") apiKey?: string,
  ) {
    const agent = await verifyAiAgentApiKey(name, apiKey);
    const result = await this.imageGeneration.generate(body.prompt);
    await this.auditLogs.write({
      actorType: "ai_agent",
      actorAgentId: agent.id,
      action: "image.generated",
      entityType: "GeneratedImage",
      entityId: result.url,
      after: { prompt: body.prompt, url: result.url },
    });
    return result;
  }

  @Post(":name/drafts")
  @Public()
  async recordDraft(
    @Param("name") name: string,
    @Body() body: DraftInput,
    @Headers("x-agent-api-key") apiKey?: string,
  ) {
    const agent = await verifyAiAgentApiKey(name, apiKey);
    return this.service.recordDraft(agent, body);
  }

  // BirrStaff-session-authenticated (no @Public()) — unlike the three
  // agent-authenticated routes above. CLAUDE.md's own words for Bashir:
  // "never auto-publishes... requires Legal/Compliance sign-off
  // specifically, not just any Birr staff member" — deliberately no
  // platform_admin override here, that would defeat the point.
  @Post(":name/drafts/:draftId/publish")
  @RequiresStaffRole(["legal_adviser", "compliance_officer"])
  async publishDraft(@Param("draftId") draftId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.publishDraft(draftId, staff);
  }
}
