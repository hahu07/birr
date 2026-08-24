import { prisma, Prisma } from "@birr/db";

/**
 * Sets app.current_founder_id for the duration of one transaction, then
 * runs fn inside it — the shared shape behind WaqfsService.list()'s and
 * FoundationsService.list()'s existing pattern (previously duplicated
 * once per call site), now also used by their findByIdForFounder()
 * counterparts. set_config(), not a bare SET LOCAL string, per the
 * empty-string-GUC fix in
 * packages/db/prisma/migrations/20260801013415_fix_founder_isolation_empty_string_gotcha
 * — SET doesn't accept bind parameters. This makes the app-layer WHERE
 * clause inside fn and the founder_isolation RLS policy both genuinely
 * scoped to the same founder for this request, not just the WHERE
 * clause alone.
 */
export function withFounderScope<T>(
  founderId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_founder_id', ${founderId}, true)`;
    return fn(tx);
  });
}
