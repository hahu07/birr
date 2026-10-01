// `pnpm --filter @birr/db sync:permissions` — see sync-permissions.ts.
// Run on every deploy by apps/backend/docker-entrypoint.sh (and the
// docker-compose `migrate` service), right after migrations. Safe to run
// any number of times; touches only roles/permissions/role_permissions.
import { PrismaClient } from "@prisma/client";
import { syncPermissions } from "./sync-permissions";

const prisma = new PrismaClient();

// Same transient-connect retry the full seed uses (Render's free-tier
// Postgres sometimes refuses the very first connection of a deploy).
async function connectWithRetry(attempts = 5, delayMs = 3000) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      console.log(`Connect attempt ${attempt}/${attempts} failed, retrying in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  await connectWithRetry();
  const result = await syncPermissions(prisma);
  console.log(
    `Synced ${result.roles} roles, ${result.permissions} permissions, ${result.grants} role grants` +
      (result.revoked > 0 ? `; switched off ${result.revoked} grant(s) no longer in seed-data.ts` : "") +
      ".",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("Permission sync failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
