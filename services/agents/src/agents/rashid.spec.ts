import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "../sdk-runtime";
import { getJson, postJson } from "../backend-client";
import { run } from "./rashid";

// See rasid.spec.ts's own comments for why each of these three mocks
// exists — identical reasoning applies to every agent in this service.
jest.mock("../sdk-runtime", () => ({ runAgent: jest.fn() }));
jest.mock("../backend-client", () => ({ getJson: jest.fn(), postJson: jest.fn() }));
jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
}));

const mockRunAgent = runAgent as jest.MockedFunction<typeof runAgent>;
const mockGetJson = getJson as jest.MockedFunction<typeof getJson>;
const mockPostJson = postJson as jest.MockedFunction<typeof postJson>;

function findTool(tools: SdkMcpToolDefinition<any>[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" was not offered to runAgent().`);
  return tool;
}

const FIXTURE_PORTFOLIO_DATA = {
  waqfPortfolios: [
    {
      waqfId: "w1",
      waqfName: "Test Waqf",
      investments: [
        { name: "Approved Sukuk", shariahScreening: { decision: "approved", flaggedSectorIds: [] } },
        { name: "Pending Murabaha", shariahScreening: { decision: null, flaggedSectorIds: [] } },
      ],
      drift: { breakdown: [], anyDrifted: false },
    },
  ],
  vaultPortfolios: [
    {
      vaultId: "v1",
      vaultName: "Test Vault",
      investments: [
        { name: "Rejected Equity", vaultShariahScreening: { decision: "rejected", flaggedSectorIds: ["gambling"] } },
      ],
      drift: { breakdown: [], anyDrifted: true },
    },
  ],
};

describe("rashid", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("run(): a real tool call sequence produces the correct captured memo and posts it with the right action/entityType", async () => {
    mockGetJson.mockResolvedValue(FIXTURE_PORTFOLIO_DATA);
    mockRunAgent.mockImplementation(async (input) => {
      await findTool(input.tools, "read_portfolio_data").handler({}, {});
      await findTool(input.tools, "screen_shariah_compliance").handler({}, {});
      await findTool(input.tools, "draft_investment_memo").handler(
        {
          summary: "One fund drifted, two screenings pending review.",
          findings: [
            { waqfId: null, vaultId: "v1", category: "drift", finding: "Test Vault has drifted from target." },
            { waqfId: "w1", vaultId: null, category: "shariah_pending", finding: "Pending Murabaha awaits Shariah review." },
          ],
        },
        {},
      );
      return { text: "done", costUsd: 0.01, turns: 3 };
    });

    await run();

    expect(mockGetJson).toHaveBeenCalledWith("rashid", "test-rashid-key", "/portfolio-data");
    expect(mockPostJson).toHaveBeenCalledWith("rashid", "test-rashid-key", "/drafts", {
      action: "investment_memo.drafted",
      entityType: "AiAgent",
      entityId: "portfolio-memo",
      draft: {
        summary: "One fund drifted, two screenings pending review.",
        findings: [
          { waqfId: null, vaultId: "v1", category: "drift", finding: "Test Vault has drifted from target." },
          { waqfId: "w1", vaultId: null, category: "shariah_pending", finding: "Pending Murabaha awaits Shariah review." },
        ],
      },
    });
  });

  test("run(): throws if the agent run never calls draft_investment_memo", async () => {
    mockRunAgent.mockResolvedValue({ text: "gave up", costUsd: 0, turns: 1 });

    await expect(run()).rejects.toThrow(/completed without calling draft_investment_memo/);
    expect(mockPostJson).not.toHaveBeenCalled();
  });

  test("screen_shariah_compliance only surfaces pending/rejected investments, never approved ones", async () => {
    mockGetJson.mockResolvedValue(FIXTURE_PORTFOLIO_DATA);
    let flagged: unknown;
    mockRunAgent.mockImplementation(async (input) => {
      const result = await findTool(input.tools, "screen_shariah_compliance").handler({}, {});
      flagged = JSON.parse((result.content[0] as { text: string }).text);
      await findTool(input.tools, "draft_investment_memo").handler({ summary: "n/a", findings: [] }, {});
      return { text: "done", costUsd: 0, turns: 1 };
    });

    await run();

    expect(flagged).toEqual([
      { waqfId: "w1", vaultId: null, investmentName: "Pending Murabaha", decision: null, flaggedSectorIds: [] },
      { waqfId: null, vaultId: "v1", investmentName: "Rejected Equity", decision: "rejected", flaggedSectorIds: ["gambling"] },
    ]);
  });
});
