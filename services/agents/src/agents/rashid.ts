import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AgentConfig } from "../agent-config";
import { getJson, postJson } from "../backend-client";
import { runAgent } from "../sdk-runtime";

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

const AGENT_NAME = "rashid";

function apiKey(): string {
  const key = process.env.RASHID_API_KEY;
  if (!key) throw new Error("RASHID_API_KEY is not configured.");
  return key;
}

// Shape of GET /ai-agents/:name/portfolio-data's response — see
// AiAgentsService.portfolioData() on the backend. Loosely typed
// (investments/drift as `any[]`/`any`) since this file only reads
// fields off them, never writes — same posture as Nazim's
// CaseDigestData interface.
interface PortfolioData {
  waqfPortfolios: Array<{ waqfId: string; waqfName: string; investments: any[]; drift: any }>;
  vaultPortfolios: Array<{ vaultId: string; vaultName: string; investments: any[]; drift: any }>;
}

const MemoFindingSchema = z.object({
  waqfId: z.string().nullable().describe("The relevant Waqf id, or null if this finding is Vault-side."),
  vaultId: z.string().nullable().describe("The relevant Vault id, or null if this finding is Waqf-side."),
  category: z.enum(["drift", "shariah_pending", "shariah_rejected"]),
  finding: z.string().describe("What the Investment Committee should know about this fund."),
});
const MemoSchema = z.object({ summary: z.string(), findings: z.array(MemoFindingSchema) });
type MemoArgs = z.infer<typeof MemoSchema>;

/** Same closure-capture pattern as Nazim's/Rasid's draft tools — see those files' own comments. */
function buildDraftTool(capture: { value?: MemoArgs }) {
  return tool(
    "draft_investment_memo",
    "Emit the final investment memo for the Investment Committee to review. Call this once, as your last step.",
    MemoSchema.shape,
    async (args) => {
      capture.value = args;
      return { content: [{ type: "text", text: args.summary }] };
    },
  );
}

const readPortfolioData = tool(
  "read_portfolio_data",
  "Fetch every Investment-type Waqf/Vault's current investments, Shariah screening status, and target-allocation drift.",
  {},
  async () => {
    const data = await getJson<PortfolioData>(AGENT_NAME, apiKey(), "/portfolio-data");
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

// Same backend endpoint as read_portfolio_data above — a focused slice
// (only investments whose Shariah screening is still pending or was
// rejected) so the model doesn't have to re-derive this itself from the
// full payload. Same "two tools, one endpoint, different field
// extraction" pattern as Nazim's read_case_assignments/
// read_governed_actions, both of which call /case-digest-data.
const screenShariahCompliance = tool(
  "screen_shariah_compliance",
  "Fetch only the investments whose Shariah screening is still pending or was rejected, across every fund.",
  {},
  async () => {
    const data = await getJson<PortfolioData>(AGENT_NAME, apiKey(), "/portfolio-data");
    const flagged = [...data.waqfPortfolios, ...data.vaultPortfolios].flatMap((portfolio) => {
      const waqfId = "waqfId" in portfolio ? portfolio.waqfId : null;
      const vaultId = "vaultId" in portfolio ? portfolio.vaultId : null;
      return portfolio.investments
        .filter((investment: any) => {
          const screening = investment.shariahScreening ?? investment.vaultShariahScreening;
          return !screening || screening.decision === null || screening.decision === "rejected";
        })
        .map((investment: any) => {
          const screening = investment.shariahScreening ?? investment.vaultShariahScreening;
          return {
            waqfId,
            vaultId,
            investmentName: investment.name,
            decision: screening?.decision ?? null,
            flaggedSectorIds: screening?.flaggedSectorIds ?? [],
          };
        });
    });
    return { content: [{ type: "text", text: JSON.stringify(flagged) }] };
  },
);

export async function run(): Promise<void> {
  const capture: { value?: MemoArgs } = {};
  const draftInvestmentMemo = buildDraftTool(capture);

  await runAgent({
    name: AGENT_NAME,
    systemPrompt:
      "You are Rashid, Birr's investment research assistant. You draft memos for the Investment Committee — " +
      "you never approve, decide, or propose anything yourself. Use read_portfolio_data for the full picture and " +
      "screen_shariah_compliance to check for pending/rejected Shariah screenings, then call " +
      "draft_investment_memo exactly once, covering both drift and Shariah findings.",
    prompt: "Review the current investment portfolio across every Waqf and Vault, then draft today's investment memo.",
    tools: [readPortfolioData, screenShariahCompliance, draftInvestmentMemo],
  });

  if (!capture.value) {
    throw new Error(`[${AGENT_NAME}] Run completed without calling draft_investment_memo.`);
  }

  await postJson(AGENT_NAME, apiKey(), "/drafts", {
    action: "investment_memo.drafted",
    entityType: "AiAgent",
    // One consolidated memo per run, not per-fund — same "digest of
    // everything" sentinel convention as Nazim's "caseload".
    entityId: "portfolio-memo",
    draft: capture.value,
  });
}
