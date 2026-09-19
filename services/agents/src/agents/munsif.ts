import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AgentConfig } from "../agent-config";
import { getJson, postJson } from "../backend-client";
import { runAgent } from "../sdk-runtime";

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

const AGENT_NAME = "munsif";

function apiKey(): string {
  const key = process.env.MUNSIF_API_KEY;
  if (!key) throw new Error("MUNSIF_API_KEY is not configured.");
  return key;
}

// Shape of GET /ai-agents/:name/beneficiary-verification-data's
// response — see AiAgentsService.beneficiaryVerificationData() on the
// backend. Deliberately never carries a name/phone/email/bank detail —
// only ids and backend-computed flags (see BeneficiariesService
// .findPossibleDuplicates/listEligibilityIssues's own comments for why).
interface VerificationData {
  duplicates: Array<{ id: string; type: "beneficiary" | "nomination"; matchedWith: { id: string; type: "beneficiary" | "nomination" }[] }>;
  eligibilityIssues: Array<{ beneficiaryId: string; waqfId: string; issues: string[] }>;
}

const RecommendationSchema = z.object({
  beneficiaryId: z.string(),
  waqfId: z.string().nullable(),
  issueType: z.enum(["duplicate", "eligibility"]),
  recommendation: z.string().describe("What Birr staff should do about this — refer to the beneficiary by id only, never by name."),
});
const MemoSchema = z.object({ summary: z.string(), recommendations: z.array(RecommendationSchema) });
type MemoArgs = z.infer<typeof MemoSchema>;

/** Same closure-capture pattern as every other agent's draft tool — see rasid.ts's own comment. */
function buildDraftTool(capture: { value?: MemoArgs }) {
  return tool(
    "draft_distribution_recommendation",
    "Emit the final beneficiary-verification recommendation memo for Birr staff to review. Call this once, as your last step. Refer to every beneficiary by id only — you were never given a name, phone, or email.",
    MemoSchema.shape,
    async (args) => {
      capture.value = args;
      return { content: [{ type: "text", text: args.summary }] };
    },
  );
}

// Same backend endpoint as check_eligibility below — a focused slice
// (possible-duplicate clusters, by id only) so the model doesn't have
// to re-derive this itself. Same "two tools, one endpoint, different
// field extraction" pattern as Nazim's/Rashid's own tool pairs.
const readBeneficiaryRecords = tool(
  "read_beneficiary_records",
  "Fetch possible-duplicate beneficiary/nomination clusters, referenced by id only — never a name, phone, or email.",
  {},
  async () => {
    const data = await getJson<VerificationData>(AGENT_NAME, apiKey(), "/beneficiary-verification-data");
    return { content: [{ type: "text", text: JSON.stringify(data.duplicates) }] };
  },
);

const checkEligibility = tool(
  "check_eligibility",
  "Fetch beneficiaries with a current eligibility problem (inactive status, or expired eligibility), referenced by id only.",
  {},
  async () => {
    const data = await getJson<VerificationData>(AGENT_NAME, apiKey(), "/beneficiary-verification-data");
    return { content: [{ type: "text", text: JSON.stringify(data.eligibilityIssues) }] };
  },
);

export async function run(): Promise<void> {
  const capture: { value?: MemoArgs } = {};
  const draftDistributionRecommendation = buildDraftTool(capture);

  await runAgent({
    name: AGENT_NAME,
    systemPrompt:
      "You are Munsif, Birr's beneficiary verification assistant. You never see beneficiary names, phone numbers, " +
      "or emails — only backend-computed duplicate/eligibility flags referenced by id. Refer to beneficiaries by " +
      "id only in everything you write; staff will look up the actual person in the Ops Console. You never " +
      "approve, decide, or propose anything yourself. Use read_beneficiary_records to check for possible " +
      "duplicates and check_eligibility to check for lapsed eligibility, then call " +
      "draft_distribution_recommendation exactly once, covering both.",
    prompt: "Review current beneficiary duplicate flags and eligibility issues, then draft today's recommendation memo.",
    tools: [readBeneficiaryRecords, checkEligibility, draftDistributionRecommendation],
  });

  if (!capture.value) {
    throw new Error(`[${AGENT_NAME}] Run completed without calling draft_distribution_recommendation.`);
  }

  await postJson(AGENT_NAME, apiKey(), "/drafts", {
    action: "distribution_recommendation.drafted",
    entityType: "AiAgent",
    // One consolidated memo per run, not per-beneficiary — same "digest
    // of everything" sentinel convention as Nazim's "caseload"/Rashid's
    // "portfolio-memo".
    entityId: "beneficiary-verification",
    draft: capture.value,
  });
}
