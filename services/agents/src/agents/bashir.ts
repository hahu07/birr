import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AgentConfig } from "../agent-config";
import { postJson } from "../backend-client";
import { runAgent } from "../sdk-runtime";

interface GenerateImageResult {
  url: string;
}

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
// (actorType: ai_agent, action: "content.published") for the same reason
// everything else does: what went out, and who approved it, stays
// attributable — see AiAgentsService.publishDraft() on the backend.
export const bashir: AgentConfig = {
  registryName: "bashir",
  nickname: "Bashir",
  taskType: "business_development",
  tools: ["read_brand_guidelines", "research_market", "generate_image", "draft_marketing_content"],
  draftOnly: true, // "draft-only" here means "never publishes unreviewed" — permanent, not a graduation stage
};

const AGENT_NAME = "bashir";

function apiKey(): string {
  const key = process.env.BASHIR_API_KEY;
  if (!key) throw new Error("BASHIR_API_KEY is not configured.");
  return key;
}

// Static company voice — genuinely real, not a stub. Brand tone is
// fixed information Birr already has, unlike Rasid's regulatory feed;
// there's no external source this could be "not yet integrated" with.
const BRAND_GUIDELINES = `
Birr is a digital trustee (Mutawalli) for Islamic waqf (endowment). Voice: professional, trustworthy, warm — never salesy or hyperbolic.
Precision matters more than persuasion here: never overstate licensing status, regulatory compliance, or investment returns. Birr today operates as a
non-profit registered in Nigeria; do not imply broader regulatory licensing than that without checking with Legal/Compliance first.
Prefer plain language over financial jargon. Center the founder/community impact of a waqf, not investment upside.
Every claim about compliance, returns, or guarantees needs Legal/Compliance sign-off before publishing — say so in "notes" if a draft makes one.
`.trim();

const readBrandGuidelines = tool(
  "read_brand_guidelines",
  "Fetch Birr's brand voice and tone guidelines to follow when drafting any content.",
  {},
  async () => {
    return { content: [{ type: "text", text: BRAND_GUIDELINES }] };
  },
);

// Honest stub — see rasid.ts's read_regulatory_sources for the same
// pattern. runAgent() strips every built-in tool (including WebFetch/
// WebSearch, see sdk-runtime.ts's own comment) from every agent, so live
// web research would need a deliberate, separate decision to grant real
// internet access to this agent — not something to default into here.
const researchMarket = tool(
  "research_market",
  "Research competitors or market context for a piece of content. NOT YET INTEGRATED — no market/competitor data source is configured.",
  { topic: z.string() },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: "No market/competitor research source is configured yet for this deployment. Do not invent competitor names, figures, or claims — state plainly in the draft's notes that market research is unavailable for this run.",
        },
      ],
    };
  },
);

// Backed by a real, pluggable image-generation call on the backend
// (AiAgentsController.generateImage -> ImageGenerationService — see
// that service's own comment for why the provider itself is a platform
// Settings switch, not something this agent chooses or even knows
// about). Genuinely optional: not every piece of content needs one.
const generateImage = tool(
  "generate_image",
  "Generate an image for this piece of content, if one would genuinely help. Returns a URL to the generated image.",
  { prompt: z.string().describe("A visual description of the image to generate — never depict specific real people, and stay consistent with the brand guidelines.") },
  async ({ prompt }) => {
    const result = await postJson<GenerateImageResult>(AGENT_NAME, apiKey(), "/generate-image", { prompt });
    return { content: [{ type: "text", text: result.url }] };
  },
);

const ContentSchema = z.object({
  contentType: z.enum(["social_post", "blog_post", "outreach_draft", "competitor_research"]),
  title: z.string(),
  body: z.string(),
  imageUrl: z.string().optional().describe("The URL returned by generate_image, if one was generated for this piece."),
  notes: z.string().optional().describe("Anything a human reviewer should know before publishing, e.g. an unverified claim or missing research."),
});
type ContentArgs = z.infer<typeof ContentSchema>;

/** Same closure-capture pattern as Rasid's/Nazim's own draft tools — see rasid.ts's comment. */
function buildDraftTool(capture: { value?: ContentArgs }) {
  return tool(
    "draft_marketing_content",
    "Emit the final piece of content for Birr staff to review. Call this once, as your last step.",
    ContentSchema.shape,
    async (args) => {
      capture.value = args;
      return { content: [{ type: "text", text: args.title }] };
    },
  );
}

export async function run(): Promise<void> {
  const capture: { value?: ContentArgs } = {};
  const draftMarketingContent = buildDraftTool(capture);

  await runAgent({
    name: AGENT_NAME,
    systemPrompt:
      "You are Bashir, Birr's business development & marketing assistant. You draft content for a human to review " +
      "and publish — you never publish anything yourself, and you never overstate licensing, compliance, or returns. " +
      "Use read_brand_guidelines for tone before writing. If research_market reports no source is configured, say so " +
      "plainly in your draft's notes rather than inventing competitor or market claims. Call generate_image only when " +
      "an image would genuinely help this specific piece, not for every piece by default — it's a real, billed " +
      "external call, not a free action. Call draft_marketing_content exactly once, as your last step.",
    prompt: "Draft one piece of outreach content aimed at prospective Founders considering establishing a waqf through Birr.",
    tools: [readBrandGuidelines, researchMarket, generateImage, draftMarketingContent],
  });

  if (!capture.value) {
    throw new Error(`[${AGENT_NAME}] Run completed without calling draft_marketing_content.`);
  }

  const entityId = `${capture.value.contentType}-${Date.now()}`;
  await postJson(AGENT_NAME, apiKey(), "/drafts", {
    action: "content.drafted",
    entityType: "MarketingContent",
    entityId,
    draft: capture.value,
  });
}
