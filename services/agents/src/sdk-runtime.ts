import { query, createSdkMcpServer, SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";

export interface RunAgentInput {
  /** Must match the agent's ai_agents registry name — used as both the MCP server name and the tool-name prefix. */
  name: string;
  systemPrompt: string;
  prompt: string;
  tools: SdkMcpToolDefinition<any>[];
  maxTurns?: number;
}

export interface RunAgentResult {
  text: string;
  costUsd: number;
  turns: number;
}

/**
 * The one place the lockdown triple is assembled — every agent gets it
 * identically rather than each agent file re-deriving it. `tools: []`
 * removes every built-in tool (Bash, Read, WebFetch, ...) from the
 * model's context entirely; `mcpServers` registers only this agent's own
 * in-process tools; `allowedTools` pre-approves exactly those and
 * nothing else; `permissionMode: "dontAsk"` denies anything not
 * pre-approved without prompting. Combined, this is the actual
 * enforcement point for CLAUDE.md's "never an approve tool for any
 * agent" — an agent can only ever call the specific read/draft tools its
 * own AgentConfig declares.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const server = createSdkMcpServer({ name: input.name, tools: input.tools });
  const allowedTools = input.tools.map((tool) => `mcp__${input.name}__${tool.name}`);

  for await (const message of query({
    prompt: input.prompt,
    options: {
      systemPrompt: input.systemPrompt,
      tools: [],
      mcpServers: { [input.name]: server },
      allowedTools,
      permissionMode: "dontAsk",
      maxTurns: input.maxTurns ?? 6,
    },
  })) {
    if (message.type !== "result") continue;
    if (message.subtype === "success") {
      return { text: message.result, costUsd: message.total_cost_usd, turns: message.num_turns };
    }
    throw new Error(`[${input.name}] Agent run ended with "${message.subtype}": ${message.errors.join(", ")}`);
  }

  throw new Error(`[${input.name}] Agent run produced no result message.`);
}
