import { UnauthorizedException } from "@nestjs/common";
import { hash, compare } from "bcryptjs";
import { prisma, AiAgent } from "@birr/db";

const BCRYPT_ROUNDS = 10;

export function hashAgentApiKey(key: string): Promise<string> {
  return hash(key, BCRYPT_ROUNDS);
}

/**
 * Mirrors password-auth.ts's verifyUserPassword, but looked up by
 * registry name (the route param — e.g. /ai-agents/rasid/...) rather
 * than a client-supplied identifier, since the caller is a service
 * process, not a browser session. bcrypt-compares the x-agent-api-key
 * header against the stored hash.
 */
export async function verifyAiAgentApiKey(name: string, apiKey: string | undefined): Promise<AiAgent> {
  if (!apiKey) {
    throw new UnauthorizedException("Missing x-agent-api-key header.");
  }
  const agent = await prisma.aiAgent.findUnique({ where: { name } });
  if (!agent || !agent.apiKeyHash) {
    throw new UnauthorizedException("Unknown agent or no API key configured.");
  }
  const matches = await compare(apiKey, agent.apiKeyHash);
  if (!matches) {
    throw new UnauthorizedException("Invalid API key.");
  }
  if (agent.status !== "active") {
    throw new UnauthorizedException("This agent is not active.");
  }
  return agent;
}
