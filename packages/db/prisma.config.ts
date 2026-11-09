// Prisma CLI configuration (Prisma 7+). Replaces the `datasource.url` in
// schema.prisma and the `prisma.seed` entry that used to live in this
// package's package.json.
//
// Prisma 7 no longer loads .env files by itself. Locally the database URL
// lives in the repo-root .env, so load it here (paths are relative to the
// working directory, which is packages/db under `pnpm --filter @birr/db
// exec`). In CI and Docker the variables are already in the environment
// and there is no .env file, so this is a no-op there.
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: [".env", "../../.env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Plain process.env rather than Prisma's env() helper: env() throws when
    // the variable is missing, and `prisma generate` runs without a database
    // (the backend Docker build, several CI jobs). Commands that actually
    // connect still fail clearly if it's empty.
    url: process.env.DATABASE_URL ?? "",
    // Scratch database for `migrate diff --from-migrations` (CI's
    // migration-drift job); Prisma 7 removed the --shadow-database-url flag.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
