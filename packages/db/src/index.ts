import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * A Prisma client connected through the node-postgres driver adapter,
 * which Prisma 7 requires for every database (its own query engine is
 * gone). The pool timeouts restate Prisma 6's defaults: pg's own defaults
 * are no connect timeout at all and a 10s idle timeout. Pool size is pg's
 * default of 10 connections per client.
 *
 * Use this only where a separate process needs its own client (seed and
 * maintenance scripts); application code imports the shared `prisma`
 * below.
 */
export function createPrismaClient(connectionString: string | undefined = process.env.DATABASE_URL): PrismaClient {
  // Fail closed. With no URL, node-postgres silently falls back to
  // localhost:5432 (and the PG* variables), which can be a different
  // database entirely. Prisma 6's client also refused to run without it.
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set, so @birr/db cannot connect to the database.");
  }
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 300_000,
  });
  return new PrismaClient({ adapter });
}

// Single shared Prisma client — import this from apps/backend and
// services/agents rather than instantiating PrismaClient elsewhere.
export const prisma = createPrismaClient();

export * from "@prisma/client";
