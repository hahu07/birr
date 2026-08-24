import { AgentConfig } from "../agent-config";

// Bashir ("the herald") — business development & digital marketing.
// NOT a fiduciary agent — never touches governed_actions. Drafts
// marketing content, campaign copy, competitor/market research, outreach
// drafts to prospective Founders.
//
// Gate is different from the other six: never auto-publishes. Any claim
// about licensing status, returns, guarantees, or regulatory compliance
// requires Legal/Compliance sign-off specifically, not just any Birr
// staff member — marketing communications about a fiduciary service are
// themselves regulated in most jurisdictions ("financial promotion"
// rules). Published output should still write to audit_logs
// (actorType: ai_agent, action: "content.published") for attribution.
export const bashir: AgentConfig = {
  registryName: "bashir",
  nickname: "Bashir",
  taskType: "business_development",
  tools: ["read_brand_guidelines", "research_market", "draft_marketing_content"],
  draftOnly: true, // "draft-only" here means "never publishes unreviewed" — permanent, not a graduation stage
};
