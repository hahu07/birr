// Shared shape for every agent's config. This is illustrative scaffolding,
// not a verified Claude Agent SDK call signature — check the current
// Agent SDK docs (@anthropic-ai/claude-agent-sdk) for the actual
// query()/ClaudeAgentOptions API before wiring these up for real.
//
// The one rule every agent config here must respect: `tools` never
// includes anything that could approve a governed_action — only propose
// (maker-side) or read-only tools. See CLAUDE.md's Agentic AI section
// for each agent's specific gate before it's allowed to call the
// backend's propose endpoint at all (most start draft-only, no writes).

export type AgentTaskType =
  | "compliance_monitoring"
  | "caseload_triage"
  | "anomaly_detection"
  | "investment_research"
  | "founder_onboarding"
  | "beneficiary_verification"
  | "business_development";

export interface AgentConfig {
  /** Must match a seeded row in the ai_agents table (see schema.prisma). */
  registryName: string;
  nickname: string;
  taskType: AgentTaskType;
  /**
   * Tool names this agent may call. Never include an "approve" or
   * "decide" tool for any agent — governed_actions.decide is a
   * human-only path, enforced at the DB level (no checker_agent_id
   * column) and should be enforced here too, by simply never exposing
   * such a tool to the SDK's tool list.
   */
  tools: string[];
  /** true until this agent has a production track record — see CLAUDE.md. */
  draftOnly: boolean;
}
