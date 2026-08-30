// The one on-demand entry point into this service — everything else
// (Rasid, Nazim) runs off the scheduler in index.ts. Rafiq's job is
// inherently per-request (a Founder mid-form asking for help right
// now), so it needs something the NestJS backend can call synchronously
// instead of a polling loop. Plain node:http, not a framework — this is
// one route, internal-network-only traffic (the backend, never a
// browser directly), and CLAUDE.md's own "start simple" posture for
// this service already argued against reaching for more than needed.
import { createServer, IncomingMessage, ServerResponse } from "http";
import { draftHelp, DraftPurposeInput } from "./agents/rafiq";

const PORT = Number(process.env.AGENT_SERVICE_PORT ?? 4100);

function internalKey(): string {
  const key = process.env.AGENT_SERVICE_INTERNAL_KEY;
  if (!key) throw new Error("AGENT_SERVICE_INTERNAL_KEY is not configured.");
  return key;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isDraftPurposeInput(value: unknown): value is DraftPurposeInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.founderName === "string" &&
    (v.kind === "institution" || v.kind === "individual") &&
    typeof v.foundationName === "string"
  );
}

export function startServer(): void {
  const server = createServer(async (req, res) => {
    // Shared-secret check — this server is never meant to be reachable
    // from a browser, only from the backend's own outbound call, so a
    // simple header comparison is proportionate (same "internal,
    // service-to-service" trust level as the agent API keys the reverse
    // direction already uses in backend-client.ts).
    if (req.headers["x-internal-key"] !== internalKey()) {
      sendJson(res, 401, { message: "Invalid or missing x-internal-key." });
      return;
    }

    if (req.method === "POST" && req.url === "/rafiq/draft-help") {
      try {
        const parsed: unknown = JSON.parse(await readBody(req));
        if (!isDraftPurposeInput(parsed)) {
          sendJson(res, 400, { message: "founderName, kind, and foundationName are required." });
          return;
        }
        const result = await draftHelp(parsed);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { message: err instanceof Error ? err.message : "Rafiq failed to draft a suggestion." });
      }
      return;
    }

    sendJson(res, 404, { message: "Not found." });
  });

  server.listen(PORT, () => {
    console.log(`Agent service HTTP server listening on :${PORT} (POST /rafiq/draft-help).`);
  });
}
