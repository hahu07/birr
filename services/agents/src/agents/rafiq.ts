import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AgentConfig } from "../agent-config";
import { runAgent } from "../sdk-runtime";

// Rafiq ("the companion") — founder onboarding & waqf establishment.
// Guides a Founder through self-service establishment in the Founder
// Portal; drafts content for the Founder's own review, never submits
// anything itself. Establishment is a Founder's own action now, not a
// governed_actions proposal a Birr officer approves — so unlike
// Rasid/Nazim, Rafiq has nothing to graduate into writing and never
// will (see CLAUDE.md's own Agentic AI table).
//
// Shape is different from Rasid/Nazim too: those are scheduled batch
// runs producing one periodic report. Rafiq is invoked on demand, once
// per request, from the onboarding wizard itself (see server.ts) — a
// Founder mid-form clicks "Help me write this," gets one suggestion
// back, and either accepts, edits, or ignores it. No polling loop, no
// draft_priority_digest-style persisted report; index.ts's RUNNERS map
// is for the scheduler, and draftHelp below is never registered there.
//
// Scope is deliberately narrow and honest: CLAUDE.md describes Rafiq as
// drafting "initial deed content from jurisdiction templates," but no
// real jurisdiction-specific legal template data source exists in this
// codebase (same honest-stub reasoning as Rasid's read_regulatory_sources)
// — inventing jurisdiction-specific legal language would be actively
// harmful for a fiduciary product to fabricate. What's real and
// achievable today: helping a Founder articulate their waqf's *purpose*
// well, which the actual deed template (see
// apps/backend/.../waqf-deeds/deed-template.ts) renders verbatim into
// the real legal text at signing time. That's a genuine, bounded task,
// not a simulation of one.
export const rafiq: AgentConfig = {
  registryName: "rafiq",
  nickname: "Rafiq",
  taskType: "founder_onboarding",
  tools: ["draft_purpose_suggestion"],
  draftOnly: true,
};

const AGENT_NAME = "rafiq";

export interface DraftPurposeInput {
  founderName: string;
  kind: "institution" | "individual";
  institutionType?: string;
  foundationName: string;
  jurisdiction?: string;
}

const PurposeSchema = z.object({
  suggestedPurpose: z
    .string()
    .describe("A clear, professional 1-2 sentence charitable purpose statement, for the Founder's own review."),
});
type PurposeArgs = z.infer<typeof PurposeSchema>;

/** Same closure-capture pattern as Rasid/Nazim's own draft tools — see rasid.ts's comment. */
function buildDraftTool(capture: { value?: PurposeArgs }) {
  return tool(
    "draft_purpose_suggestion",
    "Emit the suggested purpose statement. Call this once, as your last step.",
    { suggestedPurpose: PurposeSchema.shape.suggestedPurpose },
    async (args) => {
      capture.value = args;
      return { content: [{ type: "text", text: args.suggestedPurpose }] };
    },
  );
}

export async function draftHelp(input: DraftPurposeInput): Promise<PurposeArgs> {
  const capture: { value?: PurposeArgs } = {};
  const draftPurposeSuggestion = buildDraftTool(capture);

  const founderDescription =
    input.kind === "institution"
      ? `${input.founderName}, a${input.institutionType ? ` ${input.institutionType.replace(/_/g, " ")}` : "n institution"}`
      : `${input.founderName}, an individual`;

  await runAgent({
    name: AGENT_NAME,
    systemPrompt:
      "You are Rafiq, Birr's founder onboarding companion. You help a Founder articulate a clear, professional " +
      "charitable purpose statement for the Waqf Foundation they're establishing — a draft suggestion only, for " +
      "their own review and editing before they submit it themselves. You never submit, approve, or finalize " +
      "anything yourself, and you never invent jurisdiction-specific legal or regulatory content. Call " +
      "draft_purpose_suggestion exactly once with your suggestion.",
    prompt:
      `${founderDescription} is establishing a Foundation named "${input.foundationName}"` +
      `${input.jurisdiction ? ` in the jurisdiction of ${input.jurisdiction}` : ""}. ` +
      "Draft a suggested purpose statement for this Foundation's waqf endowment — what it exists to support. " +
      "Keep it to 1-2 sentences, genuine and specific rather than generic, suitable for the Founder to edit before " +
      "using it themselves.",
    tools: [draftPurposeSuggestion],
    maxTurns: 3,
  });

  if (!capture.value) {
    throw new Error(`[${AGENT_NAME}] Run completed without calling draft_purpose_suggestion.`);
  }
  return capture.value;
}
