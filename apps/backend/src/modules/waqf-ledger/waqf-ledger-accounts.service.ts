import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsString } from "class-validator";
import { prisma, Prisma, LedgerAccountType } from "@birr/db";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class CreateWaqfLedgerAccountInput {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsEnum(LedgerAccountType)
  type!: LedgerAccountType;
}

/**
 * The chart of accounts WaqfLedgerService's auto-posting hooks write
 * to — a shared catalog across every waqf, not per-waqf, same "one
 * standard list, staff-managed" convention as VaultLedgerAccountsService
 * (and CauseCategory before it). Four rows (Cash & Bank, Distributions
 * Payable, Contributions Revenue, Program Expenses) are seeded with
 * isSystemDefault: true; retire() refuses to touch those, since
 * removing one out from under the posting code would leave
 * WaqfLedgerService.post() with nowhere to write.
 */
@Injectable()
export class WaqfLedgerAccountsService {
  list() {
    return prisma.waqfLedgerAccount.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } });
  }

  async create(input: CreateWaqfLedgerAccountInput, actorUserId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const account = await tx.waqfLedgerAccount.create({ data: input });
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId,
            action: "waqf_ledger_account.created",
            entityType: "WaqfLedgerAccount",
            entityId: account.id,
            after: account as any,
          },
        });
        return account;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`The account code "${input.code}" is already in use.`);
      }
      throw err;
    }
  }

  async retire(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.waqfLedgerAccount.findFirst({ where: { id, deletedAt: null } });
      if (!account) throw new NotFoundException(`Ledger account "${id}" not found.`);
      if (account.isSystemDefault) {
        throw new BadRequestException(`"${account.name}" is a system default account — the auto-posting hooks write to it directly, so it can't be retired.`);
      }
      const retired = await tx.waqfLedgerAccount.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_ledger_account.retired",
          entityType: "WaqfLedgerAccount",
          entityId: account.id,
          before: account as any,
          after: retired as any,
        },
      });
      return retired;
    });
  }
}
