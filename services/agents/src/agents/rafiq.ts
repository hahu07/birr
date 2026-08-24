import { AgentConfig } from "../agent-config";

// Rafiq ("the companion") — founder onboarding & waqf establishment.
// Guides a new Founder through establishing a waqf, drafts the initial
// deed from jurisdiction templates. Waqf creation itself always stays a
// governed_actions action regardless of this agent's involvement.
// Gate: only after Milestone 2 (waqf registry) is stable.
export const rafiq: AgentConfig = {
  registryName: "rafiq",
  nickname: "Rafiq",
  taskType: "founder_onboarding",
  tools: ["read_jurisdiction_templates", "draft_waqf_deed"],
  draftOnly: true,
};
