import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { ScreenShieldAdapter } from "./providers/screenshield.adapter";

export class ResolveSanctionsScreeningInput {
  @IsString()
  notes!: string;
}

/**
 * The first slice of the sanctions/PEP screening vendor decision
 * CLAUDE.md documents (ScreenShield) — scoped to Counterparty
 * onboarding only (owner's explicit choice, 2026-09-15). See
 * SanctionsScreening's own schema comment for why this stays a direct
 * counterpartyId FK rather than a generic "subject" shape; Founder and
 * Vault-donor screening are deferred to their own later slices.
 */
@Injectable()
export class SanctionsScreeningService {
  // Concrete class, not the ScreeningProviderAdapter interface — Nest's
  // DI needs a real injection token, same as every PayoutProviderAdapter
  // implementation elsewhere in this codebase (the interface exists for
  // describing the contract/for tests to substitute a fake, not as an
  // injectable type itself). Only one provider exists today, so no Map
  // is needed the way PayoutProvider's several rails require one.
  constructor(
    private readonly adapter: ScreenShieldAdapter,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Called from CounterpartiesService.register(), inside that method's
   * own transaction — an automatic system step, not a staff decision,
   * so this writes no audit_logs entry of its own (same posture as an
   * auto-posted WaqfLedgerService/VaultLedgerService journal entry).
   * Always persists a row, regardless of outcome — the adapter's own
   * contract guarantees it never throws (see ScreeningProviderAdapter's
   * own comment).
   */
  async screen(counterpartyId: string, name: string, tx: Prisma.TransactionClient) {
    const result = await this.adapter.screen({ name });
    return tx.sanctionsScreening.create({
      data: {
        counterpartyId,
        provider: "screenshield",
        status: result.status,
        screenedName: name,
        rawResponseEncrypted: result.raw ? this.encryption.encrypt(JSON.stringify(result.raw)) : undefined,
        errorMessage: result.status === "error" ? result.errorMessage : undefined,
      },
    });
  }

  /** The one row CounterpartiesService.onboard() checks — most recent by createdAt. */
  latestFor(counterpartyId: string, client: typeof prisma | Prisma.TransactionClient = prisma) {
    return client.sanctionsScreening.findFirst({
      where: { counterpartyId },
      orderBy: { createdAt: "desc" },
    });
  }

  list(counterpartyId: string) {
    return prisma.sanctionsScreening.findMany({
      where: { counterpartyId },
      orderBy: { createdAt: "desc" },
      include: { resolvedByUser: { select: { id: true, fullName: true } } },
    });
  }

  /**
   * Plain CRUD, compliance_officer-gated at the controller — not
   * maker-checker, same "stopping/clearing needs one qualified person,
   * not dual control" reasoning CounterpartiesService.suspend()/
   * blacklist() already use. Covers both a real hit a compliance
   * officer has investigated and cleared, and a screening "error" a
   * compliance officer is manually signing off on (e.g. vendor not yet
   * configured) — resolutionNotes is where that distinction is
   * recorded, not a separate field.
   */
  async resolve(screeningId: string, notes: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const screening = await tx.sanctionsScreening.findUnique({ where: { id: screeningId } });
      if (!screening) throw new NotFoundException(`Sanctions screening "${screeningId}" not found.`);
      if (screening.status === "clear" || screening.status === "cleared") {
        throw new BadRequestException("This screening is already clear — nothing to resolve.");
      }

      const resolved = await tx.sanctionsScreening.update({
        where: { id: screeningId },
        data: { status: "cleared", resolvedAt: new Date(), resolvedByUserId: actorUserId, resolutionNotes: notes },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "sanctions_screening.resolved",
          entityType: "SanctionsScreening",
          entityId: screeningId,
          before: screening as any,
          after: resolved as any,
        },
      });
      return resolved;
    });
  }
}
