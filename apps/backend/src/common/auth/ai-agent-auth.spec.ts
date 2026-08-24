import { UnauthorizedException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { hashAgentApiKey, verifyAiAgentApiKey } from "./ai-agent-auth";

describe("verifyAiAgentApiKey", () => {
  const agentName = `test-agent-${Date.now()}`;
  const apiKey = "correct-test-key";

  beforeAll(async () => {
    // Fixture AiAgent not cleaned up in afterAll — same reasoning as
    // every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const apiKeyHash = await hashAgentApiKey(apiKey);
    await prisma.aiAgent.create({
      data: { name: agentName, taskType: "other", apiKeyHash },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("resolves the agent for a correct key", async () => {
    const agent = await verifyAiAgentApiKey(agentName, apiKey);
    expect(agent.name).toBe(agentName);
  });

  test("rejects a missing key", async () => {
    await expect(verifyAiAgentApiKey(agentName, undefined)).rejects.toThrow(UnauthorizedException);
  });

  test("rejects an incorrect key", async () => {
    await expect(verifyAiAgentApiKey(agentName, "wrong-key")).rejects.toThrow(UnauthorizedException);
  });

  test("rejects an unknown agent name", async () => {
    await expect(verifyAiAgentApiKey("no-such-agent", apiKey)).rejects.toThrow(UnauthorizedException);
  });

  test("rejects a disabled agent even with the correct key", async () => {
    const disabledName = `test-agent-disabled-${Date.now()}`;
    const disabledKey = "another-correct-key";
    await prisma.aiAgent.create({
      data: {
        name: disabledName,
        taskType: "other",
        apiKeyHash: await hashAgentApiKey(disabledKey),
        status: "disabled",
      },
    });
    await expect(verifyAiAgentApiKey(disabledName, disabledKey)).rejects.toThrow(UnauthorizedException);
  });
});
