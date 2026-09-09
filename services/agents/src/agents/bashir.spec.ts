import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "../sdk-runtime";
import { postJson } from "../backend-client";
import { run } from "./bashir";

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
const mockPostJson = postJson as jest.MockedFunction<typeof postJson>;

function findTool(tools: SdkMcpToolDefinition<any>[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" was not offered to runAgent().`);
  return tool;
}

describe("bashir", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("run(): a piece of content that skips generate_image entirely still succeeds — it's optional, not every draft needs one", async () => {
    mockRunAgent.mockImplementation(async (input) => {
      await findTool(input.tools, "read_brand_guidelines").handler({}, {});
      await findTool(input.tools, "draft_marketing_content").handler(
        { contentType: "social_post", title: "Establish your waqf with Birr", body: "...", imageUrl: undefined, notes: undefined },
        {},
      );
      return { text: "done", costUsd: 0.01, turns: 2 };
    });

    await run();

    expect(mockPostJson).toHaveBeenCalledTimes(1);
    const [agentName, apiKey, path, body] = mockPostJson.mock.calls[0];
    expect(agentName).toBe("bashir");
    expect(apiKey).toBe("test-bashir-key");
    expect(path).toBe("/drafts");
    expect(body).toMatchObject({
      action: "content.drafted",
      entityType: "MarketingContent",
      draft: { contentType: "social_post", title: "Establish your waqf with Birr" },
    });
    // entityId is `${contentType}-${Date.now()}` — assert the stable
    // prefix rather than the exact value.
    expect((body as { entityId: string }).entityId).toMatch(/^social_post-\d+$/);
  });

  test("run(): a piece of content that does call generate_image includes the returned URL via postJson('/generate-image', ...)", async () => {
    mockPostJson.mockImplementation(async (_agent, _key, path) => {
      if (path === "/generate-image") return { url: "https://images.example/generated/1.png" } as any;
      return undefined as any;
    });
    mockRunAgent.mockImplementation(async (input) => {
      const imageResult = await findTool(input.tools, "generate_image").handler({ prompt: "A serene mosque courtyard, warm light." }, {});
      const imageUrl = (imageResult.content[0] as { text: string }).text;
      await findTool(input.tools, "draft_marketing_content").handler(
        { contentType: "blog_post", title: "Waqf, explained", body: "...", imageUrl, notes: undefined },
        {},
      );
      return { text: "done", costUsd: 0.02, turns: 3 };
    });

    await run();

    expect(mockPostJson).toHaveBeenCalledWith("bashir", "test-bashir-key", "/generate-image", {
      prompt: "A serene mosque courtyard, warm light.",
    });
    const draftCall = mockPostJson.mock.calls.find(([, , path]) => path === "/drafts");
    expect(draftCall?.[3]).toMatchObject({
      draft: { imageUrl: "https://images.example/generated/1.png" },
    });
  });

  test("run(): throws if the agent run never calls draft_marketing_content", async () => {
    mockRunAgent.mockResolvedValue({ text: "gave up", costUsd: 0, turns: 1 });

    await expect(run()).rejects.toThrow(/completed without calling draft_marketing_content/);
    expect(mockPostJson).not.toHaveBeenCalled();
  });
});
