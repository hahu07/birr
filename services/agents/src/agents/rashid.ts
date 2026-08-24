import { AgentConfig } from "../agent-config";

// Rashid ("the wise") — investment research support.
// Shariah-compliance screening, portfolio drift monitoring, draft memos
// for the Investment Committee.
// Gate: only after Milestone 4 (investment/portfolio module) exists AND
// Rasid/Nazim have run clean in production — do not enable early.
export const rashid: AgentConfig = {
  registryName: "rashid",
  nickname: "Rashid",
  taskType: "investment_research",
  tools: ["read_portfolio_data", "screen_shariah_compliance", "draft_investment_memo"],
  draftOnly: true,
};
