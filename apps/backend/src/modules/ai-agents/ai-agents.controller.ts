import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { AiAgentsService, DraftInput } from "./ai-agents.service";
import { verifyAiAgentApiKey } from "../../common/auth/ai-agent-auth";
import { Public } from "../../common/guards/public.decorator";

@Controller("ai-agents")
export class AiAgentsController {
  constructor(private readonly service: AiAgentsService) {}

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
}
