import { PrismaClient } from "@prisma/client";

// Single shared Prisma client — import this from apps/backend and
// services/agents rather than instantiating PrismaClient elsewhere.
export const prisma = new PrismaClient();

export * from "@prisma/client";
