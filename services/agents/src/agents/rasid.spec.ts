import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "../sdk-runtime";
import { getJson, postJson } from "../backend-client";
import { run } from "./rasid";

// See sdk-runtime.ts's own comment for why this is the mocking seam: it
// exercises each agent's real tool-handler closures (the actual capture
// pattern, the actual postJson call at the end of run()) without ever
// faking the SDK's real async-generator wire protocol.
jest.mock("../sdk-runtime", () => ({ runAgent: jest.fn() }));
jest.mock("../backend-client", () => ({ getJson: jest.fn(), postJson: jest.fn() }));
// The real package ships ESM (.mjs) that jest's default ts-jest
// transform won't parse, and sdk-runtime.ts being mocked above doesn't
// stop rasid.ts's own top-level `import { tool } from "..."` from still
// loading the real module. `tool()`'s real implementation (per the SDK's
// own sdk.d.ts) is just `(name, description, inputSchema, handler) =>
// ({ name, description, inputSchema, handler })` — enough to stand in
// for here, since every test below only ever needs a tool's `.name` and
// `.handler`.
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

describe("rasid", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("run(): a real tool call sequence produces the correct captured draft and posts it with the right action/entityType", async () => {
    mockGetJson.mockResolvedValue([{ id: "w1", name: "Test Waqf", type: "asset", jurisdiction: "NG", status: "active" }]);
    mockRunAgent.mockImplementation(async (input) => {
      await findTool(input.tools, "read_waqf_jurisdictions").handler({}, {});
      await findTool(input.tools, "draft_compliance_report").handler(
        { summary: "All jurisdictions covered.", jurisdictionsCovered: ["NG"], notes: undefined },
        {},
      );
      return { text: "done", costUsd: 0.01, turns: 2 };
    });

    await run();

    expect(mockGetJson).toHaveBeenCalledWith("rasid", "test-rasid-key", "/jurisdiction-data");
    expect(mockPostJson).toHaveBeenCalledWith("rasid", "test-rasid-key", "/drafts", {
      action: "compliance_report.drafted",
      entityType: "AiAgent",
      entityId: "compliance-summary",
      draft: { summary: "All jurisdictions covered.", jurisdictionsCovered: ["NG"], notes: undefined },
    });
  });

  test("run(): throws if the agent run never calls draft_compliance_report", async () => {
    mockRunAgent.mockResolvedValue({ text: "gave up", costUsd: 0, turns: 1 });

    await expect(run()).rejects.toThrow(/completed without calling draft_compliance_report/);
    expect(mockPostJson).not.toHaveBeenCalled();
  });

  test("read_regulatory_sources is an honest stub — it never fabricates regulatory content", async () => {
    mockRunAgent.mockImplementation(async (input) => {
      const result = await findTool(input.tools, "read_regulatory_sources").handler({ jurisdiction: "NG" }, {});
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect((result.content[0] as { text: string }).text).toMatch(/regulatory source integration is configured/i);
      await findTool(input.tools, "draft_compliance_report").handler(
        { summary: "No source configured.", jurisdictionsCovered: [], notes: "Regulatory monitoring unavailable." },
        {},
      );
      return { text: "done", costUsd: 0, turns: 1 };
    });

    await run();
    expect(mockPostJson).toHaveBeenCalled();
  });
});
