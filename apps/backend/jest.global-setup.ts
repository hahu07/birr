import { config } from "dotenv";
import { resolve } from "path";
import { Client } from "pg";

/**
 * Registers this test run in the shared dev database, so the last run to
 * finish can suspend the staff fixtures of every run that overlapped it
 * (see jest.global-teardown.ts).
 *
 * The registration is this run's own connection, named
 * `birr-jest-run:<cover-from>` and held open until teardown, so it shows in
 * pg_stat_activity and disappears by itself if the run is killed.
 * `cover-from` is the earliest start this run's cleanup must cover: its own
 * start, or an earlier one inherited from a run still going when it began.
 * Jest shares globalThis between globalSetup and globalTeardown.
 */
export const RUN_PREFIX = "birr-jest-run:";

export default async function globalSetup(): Promise<void> {
  // Runs before jest.setup.ts, so it loads the root .env itself.
  config({ path: resolve(__dirname, "../../.env"), quiet: true });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  // Prisma stores timestamps as UTC without a zone; compare in UTC too.
  await client.query("SET TIME ZONE 'UTC'");
  const { rows } = await client.query<{ now: Date; inherited: string | null }>(
    `SELECT now() AS now,
            min(substring(application_name FROM length($1) + 1)) AS inherited
       FROM pg_stat_activity WHERE application_name LIKE $1 || '%'`,
    [RUN_PREFIX],
  );
  const { now, inherited } = rows[0]!;
  const coverFrom = inherited && new Date(inherited) < now ? new Date(inherited) : now;
  // ISO strings sort by time, so min() above finds the earliest.
  await client.query(`SELECT set_config('application_name', $1, false)`, [RUN_PREFIX + coverFrom.toISOString()]);
  (globalThis as { __testRun?: { client: Client; coverFrom: Date } }).__testRun = { client, coverFrom };
}
