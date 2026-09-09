// Entry point for the agent service. Each agent in ./agents exports its
// own scoped config (allowed tools, task type) plus a run() function.
// Nothing in this service should ever write to the database directly —
// agents call the backend API (@birr/backend), authenticated as their
// own ai_agents registry row, exactly like a human maker would through
// the UI. That keeps the maker/checker enforcement in one place
// (packages/db + apps/backend) instead of duplicated here.

import { rasid, run as runRasid } from "./agents/rasid";
import { nazim, run as runNazim } from "./agents/nazim";
import { kashif } from "./agents/kashif";
import { rashid } from "./agents/rashid";
import { rafiq } from "./agents/rafiq";
import { munsif } from "./agents/munsif";
import { bashir, run as runBashir } from "./agents/bashir";
import { startServer } from "./server";

export const agents = { rasid, nazim, kashif, rashid, rafiq, munsif, bashir };

// The three agents with a real run() (see agents/rasid.ts, agents/nazim.ts,
// agents/bashir.ts) are schedulable today — the rest are config-only
// scaffolding for a later build phase (CLAUDE.md's own graduation
// ordering). Rafiq is real too, but shaped differently: it's invoked on
// demand via startServer() below, never on this interval-based RUNNERS
// map — see rafiq.ts's own comment.
const RUNNERS: Record<string, () => Promise<void>> = {
  rasid: runRasid,
  nazim: runNazim,
  bashir: runBashir,
};

async function runOne(name: string): Promise<void> {
  const runner = RUNNERS[name];
  if (!runner) {
    throw new Error(`No runnable agent named "${name}" — available: ${Object.keys(RUNNERS).join(", ")}.`);
  }
  console.log(`[${name}] run starting…`);
  try {
    await runner();
    console.log(`[${name}] run complete.`);
  } catch (err) {
    console.error(`[${name}] run failed:`, err instanceof Error ? err.message : err);
  }
}

// Basic cron/queue per CLAUDE.md ("start simple... reach for Temporal
// only once concurrent agent workflows make execution history genuinely
// hard to track without it") — a single setInterval covering every
// runnable agent. governed_actions.status = 'proposed' already serves as
// the "waiting on a human" pause state downstream of any agent that
// eventually does propose one; neither Rasid nor Nazim does yet (both
// draft-only), so there's nothing more elaborate to coordinate here.
function startScheduler(): void {
  const intervalMs = Number(process.env.AGENT_POLL_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
  console.log(`Agent scheduler starting — running [${Object.keys(RUNNERS).join(", ")}] every ${intervalMs}ms.`);

  const tick = () => {
    for (const name of Object.keys(RUNNERS)) {
      void runOne(name);
    }
  };

  tick();
  setInterval(tick, intervalMs);
}

// `node dist/index.js --once <agentName>` runs one agent immediately and
// exits — for manual triggering/testing without waiting on the interval.
async function main(): Promise<void> {
  const onceIndex = process.argv.indexOf("--once");
  if (onceIndex !== -1) {
    const name = process.argv[onceIndex + 1];
    if (!name) {
      throw new Error("--once requires an agent name, e.g. `--once nazim`.");
    }
    await runOne(name);
    return;
  }
  startServer();
  startScheduler();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
