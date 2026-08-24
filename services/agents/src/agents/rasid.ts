import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AgentConfig } from "../agent-config";
import { getJson, postJson } from "../backend-client";
import { runAgent } from "../sdk-runtime";

// Rasid ("the observer") — compliance & regulatory monitoring.
// Watches jurisdiction-specific regulatory change per waqf (via
// waqfs.jurisdiction, not the founder's home jurisdiction), drafts
// impact summaries, assembles audit evidence continuously.
// Build-priority: 1st. Pilot this one first — lowest risk, highest volume.
//
// Scope note: read_regulatory_sources has no backing data source in
// this codebase (no feed, no ingested regulatory text, no API) —
// deliberately implemented as an honest stub below rather than inventing
// regulatory content, which would be actively harmful for a fiduciary
// compliance agent to fabricate. read_waqf_jurisdictions and
// draft_compliance_report are fully real. Wire a real source once one is
// chosen; this is a product/legal decision, not something to guess at.
export const rasid: AgentConfig = {
  registryName: "rasid",
  nickname: "Rasid",
  taskType: "compliance_monitoring",
  tools: ["read_waqf_jurisdictions", "read_regulatory_sources", "draft_compliance_report"],
  draftOnly: true, // graduates only once officers consistently act on its drafts unedited
};

const AGENT_NAME = "rasid";

function apiKey(): string {
  const key = process.env.RASID_API_KEY;
  if (!key) throw new Error("RASID_API_KEY is not configured.");
  return key;
}

interface JurisdictionRow {
  id: string;
  name: string;
  type: string;
  jurisdiction: string;
  status: string;
}

const ReportSchema = z.object({
  summary: z.string(),
  jurisdictionsCovered: z.array(z.string()),
  notes: z.string().optional().describe("Anything Rasid could not assess, e.g. missing regulatory-source coverage."),
});
type ReportArgs = z.infer<typeof ReportSchema>;

/** Same closure-capture pattern as Nazim's draft tool — see that file's comment. */
function buildDraftTool(capture: { value?: ReportArgs }) {
  return tool(
    "draft_compliance_report",
    "Emit the final compliance impact summary for Birr staff to review. Call this once, as your last step.",
    { summary: ReportSchema.shape.summary, jurisdictionsCovered: ReportSchema.shape.jurisdictionsCovered, notes: ReportSchema.shape.notes },
    async (args) => {
      capture.value = args;
      return { content: [{ type: "text", text: args.summary }] };
    },
  );
}

const readWaqfJurisdictions = tool(
  "read_waqf_jurisdictions",
  "Fetch every active waqf's jurisdiction, so compliance coverage can be grouped by jurisdiction.",
  {},
  async () => {
    const data = await getJson<JurisdictionRow[]>(AGENT_NAME, apiKey(), "/jurisdiction-data");
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

// Honest stub — see this file's top comment. Returns isError: false (not
// a tool failure) so the model treats "no source configured" as real
// information to reason about and disclose, not a retry-able error.
const readRegulatorySources = tool(
  "read_regulatory_sources",
  "Fetch recent jurisdiction-specific regulatory changes. NOT YET INTEGRATED — no regulatory data source is configured.",
  { jurisdiction: z.string() },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: "No regulatory source integration is configured yet for this deployment. Do not infer or invent regulatory content — state plainly in your report that regulatory-change monitoring is unavailable for this run.",
        },
      ],
    };
  },
);

export async function run(): Promise<void> {
  const capture: { value?: ReportArgs } = {};
  const draftComplianceReport = buildDraftTool(capture);

  await runAgent({
    name: AGENT_NAME,
    systemPrompt:
      "You are Rasid, Birr's compliance & regulatory monitoring assistant. You draft impact summaries per " +
      "jurisdiction — you never approve, decide, or propose anything yourself, and you never invent regulatory " +
      "content. If read_regulatory_sources reports no source is configured, say so plainly in your report rather " +
      "than guessing. Use read_waqf_jurisdictions to see jurisdiction coverage, then call " +
      "draft_compliance_report exactly once.",
    prompt: "Review current waqf jurisdiction coverage and draft today's compliance summary.",
    tools: [readWaqfJurisdictions, readRegulatorySources, draftComplianceReport],
  });

  if (!capture.value) {
    throw new Error(`[${AGENT_NAME}] Run completed without calling draft_compliance_report.`);
  }

  await postJson(AGENT_NAME, apiKey(), "/drafts", {
    action: "compliance_report.drafted",
    entityType: "AiAgent",
    entityId: "compliance-summary",
    draft: capture.value,
  });
}
