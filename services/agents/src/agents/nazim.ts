import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AgentConfig } from "../agent-config";
import { getJson, postJson } from "../backend-client";
import { runAgent } from "../sdk-runtime";

// Nazim ("the organizer") — officer caseload triage.
// Surfaces what needs attention today across a waqf_case_assignments
// caseload. May never need to write governed_actions at all.
export const nazim: AgentConfig = {
  registryName: "nazim",
  nickname: "Nazim",
  taskType: "caseload_triage",
  tools: ["read_case_assignments", "read_governed_actions", "draft_priority_digest"],
  draftOnly: true,
};

const AGENT_NAME = "nazim";

function apiKey(): string {
  const key = process.env.NAZIM_API_KEY;
  if (!key) throw new Error("NAZIM_API_KEY is not configured.");
  return key;
}

interface CaseDigestData {
  openGovernedActions: Array<{
    id: string;
    waqfId: string | null;
    status: string;
    createdAt: string;
    makerType: string;
    permission: { key: string };
  }>;
  caseAssignments: Array<{
    id: string;
    waqfId: string;
    birrStaffId: string;
    assignmentRole: string;
    status: string;
  }>;
}

const DigestItemSchema = z.object({
  waqfId: z.string().nullable().describe("The relevant Waqf id, or null if not waqf-specific."),
  reason: z.string().describe("Why this needs an officer's attention today."),
  priority: z.enum(["high", "medium", "low"]),
});
const DigestSchema = z.object({ summary: z.string(), items: z.array(DigestItemSchema) });
type DigestArgs = z.infer<typeof DigestSchema>;

/**
 * Captures the model's one draft_priority_digest call so run() can
 * persist it after the query completes — runAgent()'s own return value
 * is only the final assistant text, not a specific tool call's
 * structured input, and this service runs one agent at a time
 * (sequential scheduler), so a closure-scoped variable per run is
 * enough; it isn't shared across concurrent runs because each call to
 * buildDraftTool() below gets its own.
 */
function buildDraftTool(capture: { value?: DigestArgs }) {
  return tool(
    "draft_priority_digest",
    "Emit the final prioritized caseload digest for Birr staff to review. Call this once, as your last step, after reviewing the caseload and governed actions.",
    DigestSchema.shape,
    async (args) => {
      capture.value = args;
      return { content: [{ type: "text", text: args.summary }] };
    },
  );
}

const readCaseAssignments = tool(
  "read_case_assignments",
  "Fetch the current active waqf_case_assignments caseload — which Birr staff member owns which waqf's case, and in what role.",
  {},
  async () => {
    const data = await getJson<CaseDigestData>(AGENT_NAME, apiKey(), "/case-digest-data");
    return { content: [{ type: "text", text: JSON.stringify(data.caseAssignments) }] };
  },
);

const readGovernedActions = tool(
  "read_governed_actions",
  "Fetch governed_actions currently awaiting a checker decision (status=proposed).",
  {},
  async () => {
    const data = await getJson<CaseDigestData>(AGENT_NAME, apiKey(), "/case-digest-data");
    return { content: [{ type: "text", text: JSON.stringify(data.openGovernedActions) }] };
  },
);

export async function run(): Promise<void> {
  const capture: { value?: DigestArgs } = {};
  const draftPriorityDigest = buildDraftTool(capture);

  await runAgent({
    name: AGENT_NAME,
    systemPrompt:
      "You are Nazim, Birr's officer caseload triage assistant. You surface what needs a Birr officer's " +
      "attention today across the current caseload — you never approve, decide, or propose anything yourself. " +
      "Use read_case_assignments and read_governed_actions to gather context, then call draft_priority_digest " +
      "exactly once with a concise summary and a prioritized list of items.",
    prompt: "Review today's caseload and open governed actions, then draft today's priority digest.",
    tools: [readCaseAssignments, readGovernedActions, draftPriorityDigest],
  });

  if (!capture.value) {
    throw new Error(`[${AGENT_NAME}] Run completed without calling draft_priority_digest.`);
  }

  await postJson(AGENT_NAME, apiKey(), "/drafts", {
    action: "caseload_digest.drafted",
    entityType: "BirrStaff",
    // No single BirrStaff owns a caseload-wide digest — entityId is a
    // fixed sentinel for this action type rather than a per-item id,
    // same reasoning as any "digest of everything" audit entry.
    entityId: "caseload",
    draft: capture.value,
  });
}
