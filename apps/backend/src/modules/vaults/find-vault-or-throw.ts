import { NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@birr/db";

/**
 * The "look up a vault, 404 if it's missing or soft-deleted" two-liner
 * that was copy-pasted identically across every Vault-side service
 * (found in a codebase audit) — accepts either the plain `prisma`
 * client or a transaction's `tx`, since call sites need both. Scoped to
 * the Vault side only; the Waqf side has the same duplicated pattern
 * independently, left untouched here since Vault and Waqf are
 * deliberately parallel, never-shared products (see CLAUDE.md).
 */
export async function findVaultOrThrow(client: typeof prisma | Prisma.TransactionClient, id: string) {
  const vault = await client.vault.findFirst({ where: { id, deletedAt: null } });
  if (!vault) throw new NotFoundException(`Vault "${id}" not found.`);
  return vault;
}
