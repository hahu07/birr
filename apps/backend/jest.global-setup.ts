import { config } from "dotenv";
import { resolve } from "path";

/**
 * Notes when this test run started, by the database's own clock, so
 * jest.global-teardown.ts can suspend exactly the staff fixtures this run
 * created. Jest shares globalThis between globalSetup and globalTeardown.
 */
export default async function globalSetup(): Promise<void> {
  // Runs before jest.setup.ts, so it loads the root .env itself.
  config({ path: resolve(__dirname, "../../.env"), quiet: true });
  const { prisma } = await import("@birr/db");
  const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  (globalThis as { __testRunStartedAt?: Date }).__testRunStartedAt = now;
  await prisma.$disconnect();
}
