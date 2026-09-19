import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "../sdk-runtime";
import { getJson, postJson } from "../backend-client";
import { run } from "./munsif";

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

const FIXTURE_VERIFICATION_DATA = {
  duplicates: [
    { id: "b1", type: "beneficiary" as const, matchedWith: [{ id: "n1", type: "nomination" as const }] },
    { id: "n1", type: "nomination" as const, matchedWith: [{ id: "b1", type: "beneficiary" as const }] },
  ],
  eligibilityIssues: [{ beneficiaryId: "b2", waqfId: "w1", issues: ["eligibility_expired"] }],
};

describe("munsif", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("run(): a real tool call sequence produces the correct captured memo and posts it with the right action/entityType", async () => {
    mockGetJson.mockResolvedValue(FIXTURE_VERIFICATION_DATA);
    mockRunAgent.mockImplementation(async (input) => {
      await findTool(input.tools, "read_beneficiary_records").handler({}, {});
      await findTool(input.tools, "check_eligibility").handler({}, {});
      await findTool(input.tools, "draft_distribution_recommendation").handler(
        {
          summary: "One possible duplicate, one lapsed eligibility.",
          recommendations: [
            { beneficiaryId: "b1", waqfId: null, issueType: "duplicate", recommendation: "Beneficiary b1 may match pending nomination n1 — verify before approving." },
            { beneficiaryId: "b2", waqfId: "w1", issueType: "eligibility", recommendation: "Beneficiary b2's eligibility has expired — renew before any distribution." },
          ],
        },
        {},
      );
      return { text: "done", costUsd: 0.01, turns: 3 };
    });

    await run();

    expect(mockGetJson).toHaveBeenCalledWith("munsif", "test-munsif-key", "/beneficiary-verification-data");
    expect(mockPostJson).toHaveBeenCalledWith("munsif", "test-munsif-key", "/drafts", {
      action: "distribution_recommendation.drafted",
      entityType: "AiAgent",
      entityId: "beneficiary-verification",
      draft: {
        summary: "One possible duplicate, one lapsed eligibility.",
        recommendations: [
          { beneficiaryId: "b1", waqfId: null, issueType: "duplicate", recommendation: "Beneficiary b1 may match pending nomination n1 — verify before approving." },
          { beneficiaryId: "b2", waqfId: "w1", issueType: "eligibility", recommendation: "Beneficiary b2's eligibility has expired — renew before any distribution." },
        ],
      },
    });
  });

  test("run(): throws if the agent run never calls draft_distribution_recommendation", async () => {
    mockRunAgent.mockResolvedValue({ text: "gave up", costUsd: 0, turns: 1 });

    await expect(run()).rejects.toThrow(/completed without calling draft_distribution_recommendation/);
    expect(mockPostJson).not.toHaveBeenCalled();
  });

  test("read_beneficiary_records and check_eligibility each surface only their own slice of the backend response", async () => {
    mockGetJson.mockResolvedValue(FIXTURE_VERIFICATION_DATA);
    let duplicatesSeen: unknown;
    let eligibilitySeen: unknown;
    mockRunAgent.mockImplementation(async (input) => {
      const dupResult = await findTool(input.tools, "read_beneficiary_records").handler({}, {});
      duplicatesSeen = JSON.parse((dupResult.content[0] as { text: string }).text);
      const eligResult = await findTool(input.tools, "check_eligibility").handler({}, {});
      eligibilitySeen = JSON.parse((eligResult.content[0] as { text: string }).text);
      await findTool(input.tools, "draft_distribution_recommendation").handler({ summary: "n/a", recommendations: [] }, {});
      return { text: "done", costUsd: 0, turns: 1 };
    });

    await run();

    expect(duplicatesSeen).toEqual(FIXTURE_VERIFICATION_DATA.duplicates);
    expect(eligibilitySeen).toEqual(FIXTURE_VERIFICATION_DATA.eligibilityIssues);
  });
});
