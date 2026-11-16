import { RUN_PREFIX } from "./jest.global-setup";
import type { Client } from "pg";

/**
 * Suspends test staff fixtures once no test run is using them. They can't
 * be deleted (audit_logs refers to their users and is insert-only), but
 * left active they pile up in the shared dev database. Every later run's
 * "notify every compliance officer" style fan-out then reaches thousands
 * of them, which filled the connection pool and timed tests out (the
 * conflict-of-interest spec, 2026-11-14).
 *
 * Another run still going (CI, a teammate) may be using fixtures created
 * since this one started, so while any is registered this does nothing:
 * the last run to finish cleans up for everyone, from the earliest start
 * it inherited (see jest.global-setup.ts). Only staff with a test-domain
 * email created in that window are touched; accounts made before it, even
 * on example.com, never are. If every run is killed before this point,
 * their fixtures stay active; suspend them by hand.
 */
export default async function globalTeardown(): Promise<void> {
  const run = (globalThis as { __testRun?: { client: Client; coverFrom: Date } }).__testRun;
  if (!run) return;
  try {
    const { rows } = await run.client.query<{ others: number }>(
      `SELECT count(*)::int AS others FROM pg_stat_activity WHERE application_name LIKE $1 || '%' AND pid <> pg_backend_pid()`,
      [RUN_PREFIX],
    );
    if (rows[0]!.others > 0) {
      console.log(`\nAnother test run is still going; it will suspend this run's test staff when it finishes.`);
      return;
    }
    const { rowCount } = await run.client.query(
      `UPDATE birr_staff s SET status = 'suspended', "updatedAt" = now()
         FROM users u
        WHERE u.id = s."userId" AND s.status = 'active'
          -- createdAt is UTC without a zone: convert explicitly, or a Date
          -- sent with the machine's offset (+01:00 in Lagos) is read an
          -- hour late and nothing matches.
          AND s."createdAt" >= ($1::timestamptz AT TIME ZONE 'UTC')
          AND (u.email LIKE '%@example.com' OR u.email LIKE '%@example.test')`,
      [run.coverFrom.toISOString()],
    );
    if (rowCount) console.log(`\nSuspended ${rowCount} test staff fixture(s) created since ${run.coverFrom.toISOString()}.`);
  } finally {
    await run.client.end();
  }
}
