// One-off backfill for the Founder -> Foundation -> Waqf Fund -> Cause
// restructuring. Run once, between migration A
// (add_foundation_and_cause_models) and migration C
// (enforce_foundation_and_cause_not_null) — C's guard fails loudly if
// this hasn't been run first.
//
// Reads the old `waqf_founders` table via raw SQL, not the Prisma
// client, because the WaqfFounder model was already removed from
// schema.prisma in the same commit that added Foundation (migration A
// only adds new tables/columns — it doesn't drop waqf_founders yet,
// that's migration D — but the *Prisma client* generated from the
// current schema has no model for it any more).
//
// Idempotent: safe to re-run. Already-backfilled waqfs/distributions
// and the shared "Unaffiliated Waqfs"/per-waqf "General" cause records
// are detected and skipped/reused, not duplicated.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface WaqfFounderRow {
  waqfId: string;
  founderId: string;
}

async function main() {
  const waqfs = await prisma.waqf.findMany({
    where: { foundationId: null },
    select: { id: true },
  });

  const waqfFounderRows = await prisma.$queryRaw<WaqfFounderRow[]>`
    SELECT "waqfId", "founderId" FROM "waqf_founders"
  `;
  const foundersByWaqf = new Map<string, string[]>();
  for (const row of waqfFounderRows) {
    const list = foundersByWaqf.get(row.waqfId) ?? [];
    list.push(row.founderId);
    foundersByWaqf.set(row.waqfId, list);
  }

  // Group by the *exact* sorted founder-id set — a waqf backed by {A}
  // and one backed by {A, B} get two different synthetic Foundations,
  // since B never co-established the first one. Empty set (waqfs with
  // zero waqf_founders rows — several exist today, created directly via
  // prisma.waqf.create in test fixtures) is its own group, routed to a
  // single shared orphan Foundation.
  const groups = new Map<string, { founderIds: string[]; waqfIds: string[] }>();
  for (const waqf of waqfs) {
    const founderIds = [...new Set(foundersByWaqf.get(waqf.id) ?? [])].sort();
    const key = founderIds.join(",");
    if (!groups.has(key)) groups.set(key, { founderIds, waqfIds: [] });
    groups.get(key)!.waqfIds.push(waqf.id);
  }

  let foundationCount = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const [key, group] of groups) {
        let foundationId: string;

        if (key === "") {
          const existing = await tx.foundation.findFirst({
            where: { name: "Unaffiliated Waqfs" },
          });
          const foundation =
            existing ??
            (await tx.foundation.create({
              data: {
                name: "Unaffiliated Waqfs",
                purpose:
                  "Backfill placeholder for pre-Foundation waqfs with no recorded founder.",
              },
            }));
          foundationId = foundation.id;
        } else {
          const founders = await tx.founder.findMany({
            where: { id: { in: group.founderIds } },
          });
          const label = founders.map((f) => f.name).join(" & ");
          const foundation = await tx.foundation.create({
            data: {
              name: `${label} (auto-backfilled — rename me)`,
              purpose:
                "Auto-created during Foundation backfill; verify and rename.",
            },
          });
          await tx.foundationFounder.createMany({
            data: group.founderIds.map((founderId) => ({
              foundationId: foundation.id,
              founderId,
            })),
          });
          foundationId = foundation.id;
        }
        foundationCount += 1;

        await tx.waqf.updateMany({
          where: { id: { in: group.waqfIds } },
          data: { foundationId },
        });

        // One "General" cause per waqf, used only to backfill existing
        // Distributions (Beneficiary.causeId stays legitimately null —
        // it's nullable by design, no beneficiary needs to be forced
        // into a cause it never had).
        for (const waqfId of group.waqfIds) {
          const existingCause = await tx.waqfCause.findFirst({
            where: { waqfId, name: "General" },
          });
          const generalCause =
            existingCause ??
            (await tx.waqfCause.create({
              data: {
                waqfId,
                name: "General",
                description:
                  "Default cause for records that predate cause tracking.",
              },
            }));
          await tx.distribution.updateMany({
            where: { waqfId, causeId: null },
            data: { causeId: generalCause.id },
          });
        }
      }
    },
    { timeout: 30_000 },
  );

  console.log(
    `Backfilled ${waqfs.length} waqf(s) into ${foundationCount} foundation(s) (${groups.size} distinct founder-set group(s)).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
