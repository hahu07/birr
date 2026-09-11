import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";

export class RecordVaultProceedsInput {
  @IsString()
  vaultId!: string;

  @IsOptional()
  @IsString()
  vaultInvestmentId?: string;

  @IsNumberString()
  amount!: Prisma.Decimal | number | string;

  @IsString()
  currency!: string;

  @IsString()
  description!: string;
}

@Injectable()
export class VaultProceedsService {
  /**
   * Birr-staff only — mirrors WaqfProceedsService.record()'s own trust
   * level (investment performance isn't self-service for a Founder
   * either). Append-only by convention, same posture as WaqfProceeds —
   * no update/delete route exists; a correction is a new, possibly
   * negative, entry. Unlike WaqfProceedsService.record(), does NOT
   * auto-fire a proportional-allocation re-run afterward — that's a
   * later UX nicety added to the Waqf flow at the owner's specific
   * request, not something asked for here; staff trigger
   * vault.proceeds_allocate explicitly when ready.
   */
  async record(input: RecordVaultProceedsInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const vault = await tx.vault.findFirst({ where: { id: input.vaultId, deletedAt: null } });
      if (!vault) throw new NotFoundException(`Vault "${input.vaultId}" not found.`);
      if (vault.type !== "investment") {
        throw new BadRequestException(
          `Only investment-style vaults have investment proceeds to record — "${vault.name}" is ${vault.type}.`,
        );
      }

      const proceeds = await tx.vaultProceeds.create({ data: { ...input, recordedByUserId: actorUserId } });
      await tx.auditLog.create({
        data: {
          vaultId: input.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_proceeds.recorded",
          entityType: "VaultProceeds",
          entityId: proceeds.id,
          after: proceeds as any,
        },
      });
      return proceeds;
    });
  }

  /** Same aggregate WaqfProceedsService.sumForWaqf provides, vault-scoped. */
  async sumForVault(vaultId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<Prisma.Decimal> {
    const result = await client.vaultProceeds.aggregate({ where: { vaultId }, _sum: { amount: true } });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  list(vaultId?: string) {
    return prisma.vaultProceeds.findMany({
      where: vaultId ? { vaultId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }
}
