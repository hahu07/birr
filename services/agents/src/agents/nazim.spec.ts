import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "../sdk-runtime";
import { getJson, postJson } from "../backend-client";
import { run } from "./nazim";

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

const FIXTURE_DIGEST_DATA = {
  openGovernedActions: [
    { id: "ga1", waqfId: "w1", status: "proposed", createdAt: "2026-09-09T00:00:00.000Z", makerType: "human", permission: { key: "asset.dispose" } },
  ],
  caseAssignments: [{ id: "ca1", waqfId: "w1", birrStaffId: "s1", assignmentRole: "mutawalli_officer", status: "active" }],
};

describe("nazim", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("run(): a real tool call sequence produces the correct captured digest and posts it with the right action/entityType", async () => {
    mockGetJson.mockResolvedValue(FIXTURE_DIGEST_DATA);
    mockRunAgent.mockImplementation(async (input) => {
      await findTool(input.tools, "read_case_assignments").handler({}, {});
      await findTool(input.tools, "read_governed_actions").handler({}, {});
      await findTool(input.tools, "draft_priority_digest").handler(
        {
          summary: "One action awaiting decision.",
          items: [{ waqfId: "w1", reason: "asset.dispose is awaiting a checker.", priority: "high" }],
        },
        {},
      );
      return { text: "done", costUsd: 0.01, turns: 2 };
    });

    await run();

    expect(mockGetJson).toHaveBeenCalledWith("nazim", "test-nazim-key", "/case-digest-data");
    expect(mockPostJson).toHaveBeenCalledWith("nazim", "test-nazim-key", "/drafts", {
      action: "caseload_digest.drafted",
      entityType: "BirrStaff",
      entityId: "caseload",
      draft: {
        summary: "One action awaiting decision.",
        items: [{ waqfId: "w1", reason: "asset.dispose is awaiting a checker.", priority: "high" }],
      },
    });
  });

  test("run(): throws if the agent run never calls draft_priority_digest", async () => {
    mockRunAgent.mockResolvedValue({ text: "gave up", costUsd: 0, turns: 1 });

    await expect(run()).rejects.toThrow(/completed without calling draft_priority_digest/);
    expect(mockPostJson).not.toHaveBeenCalled();
  });
});
