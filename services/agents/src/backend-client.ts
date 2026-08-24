// Every read/write this service does goes through the NestJS backend's
// API, authenticated as the calling agent's own ai_agents registry row —
// never a direct DB connection. See index.ts's own comment for why.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

async function request(agentName: string, apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-agent-api-key": apiKey,
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message ?? `Request to ${path} failed with status ${res.status}.`;
    throw new Error(`[${agentName}] ${Array.isArray(message) ? message.join(", ") : message}`);
  }
  return body;
}

export function getJson<T>(agentName: string, apiKey: string, path: string): Promise<T> {
  return request(agentName, apiKey, `/ai-agents/${agentName}${path}`);
}

export function postJson<T>(agentName: string, apiKey: string, path: string, body: unknown): Promise<T> {
  return request(agentName, apiKey, `/ai-agents/${agentName}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
