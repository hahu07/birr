import { AgentConfig } from "../agent-config";

// Munsif ("the fair one") — beneficiary verification & distribution prep.
// Checks eligibility, flags duplicates, drafts distribution
// recommendations. Still gated by distribution.approve with a human
// checker. This is the LAST agent to enable — it directly precedes money
// reaching a real person. Gate: Milestone 6 exists AND every earlier
// agent has a clean production track record.
export const munsif: AgentConfig = {
  registryName: "munsif",
  nickname: "Munsif",
  taskType: "beneficiary_verification",
  tools: ["read_beneficiary_records", "check_eligibility", "draft_distribution_recommendation"],
  draftOnly: true,
};
