import { AgentConfig } from "../agent-config";

// Kashif ("the revealer") — anomaly & conflict-of-interest detection.
// Pattern-spots unusual maker/checker pairings and atypical timing
// across governed_actions history.
export const kashif: AgentConfig = {
  registryName: "kashif",
  nickname: "Kashif",
  taskType: "anomaly_detection",
  tools: ["read_governed_actions_history", "read_coi_declarations", "draft_anomaly_flag"],
  draftOnly: true,
};
