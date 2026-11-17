import { DateField, LongTextField, NameField, ReferenceField } from "../../common/validation/fields";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsOptional, Matches } from "class-validator";
import { prisma, Prisma, CounterpartyLicense, CounterpartyLicenseKind } from "@birr/db";
import { COUNTERPARTY_LICENSE_KIND_LABELS, REQUIRED_COUNTERPARTY_LICENSES } from "@birr/shared";

type Db = Prisma.TransactionClient | typeof prisma;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class RecordCounterpartyLicenseInput {
  @IsEnum(CounterpartyLicenseKind)
  kind!: CounterpartyLicenseKind;

  @ReferenceField()
  licenseNumber!: string;

  @NameField()
  issuingAuthority!: string;

  @IsOptional()
  @DateField()
  @Matches(DAY, { message: "issuedOn must be a date like 2027-01-31." })
  issuedOn?: string;

  @DateField()
  @Matches(DAY, { message: "expiresOn must be a date like 2027-01-31." })
  expiresOn!: string;
}

export class VerifyCounterpartyLicenseInput {
  // How they checked it: "Saw the original; confirmed on the MLSCN register".
  @LongTextField()
  note!: string;
}

export class WithdrawCounterpartyLicenseInput {
  @LongTextField()
  reason!: string;
}

/** Today's date in Nigeria, where Birr operates (UTC+1, no daylight saving). */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** A licence that counts: verified, not withdrawn, and in date today. */
function counts(license: CounterpartyLicense, today: string): boolean {
  return license.verifiedAt !== null && license.withdrawnAt === null && isoDate(license.expiresOn) >= today;
}

export type LicenseRequirementStatus = "current" | "expired" | "awaiting_verification" | "missing";

export interface LicenseRequirement {
  kind: CounterpartyLicenseKind;
  status: LicenseRequirementStatus;
  /** For "current": the date it runs to. For "expired": the date it lapsed. */
  expiresOn: string | null;
}

/**
 * Where each licence a counterparty's type requires stands today. Empty
 * for a type with no required licences (everything but a healthcare
 * provider), so those are never held up by this.
 */
export async function licenseRequirements(
  db: Db,
  counterparty: { id: string; institutionType: string },
  today = lagosToday(),
): Promise<LicenseRequirement[]> {
  const required = REQUIRED_COUNTERPARTY_LICENSES[counterparty.institutionType] ?? [];
  if (required.length === 0) return [];
  const licenses = await db.counterpartyLicense.findMany({
    where: { counterpartyId: counterparty.id, kind: { in: [...required] }, withdrawnAt: null },
    orderBy: { expiresOn: "desc" },
  });
  return required.map((kind) => {
    const ofKind = licenses.filter((l) => l.kind === kind);
    const current = ofKind.find((l) => counts(l, today));
    if (current) return { kind, status: "current", expiresOn: isoDate(current.expiresOn) };
    const lapsed = ofKind.find((l) => l.verifiedAt !== null);
    if (lapsed) return { kind, status: "expired", expiresOn: isoDate(lapsed.expiresOn) };
    if (ofKind.length > 0) return { kind, status: "awaiting_verification", expiresOn: null };
    return { kind, status: "missing", expiresOn: null };
  });
}

/**
 * Refuses unless every licence the counterparty's type requires is
 * verified and in date. Called wherever Birr commits to paying a
 * counterparty (onboarding, Vault and zakah distributions), and again at
 * approval. Inside a transaction it holds a share lock on the counterparty,
 * which a verification or withdrawal waits on (they take FOR UPDATE), so a
 * licence can't be withdrawn between this check and the payment it allows.
 */
export async function assertLicensesCurrent(db: Db, counterpartyId: string, today = lagosToday()): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "counterparties" WHERE "id" = ${counterpartyId} FOR SHARE`;
  const counterparty = await db.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true, name: true, institutionType: true },
  });
  if (!counterparty) throw new NotFoundException(`Counterparty "${counterpartyId}" not found.`);
  const gaps = (await licenseRequirements(db, counterparty, today)).filter((r) => r.status !== "current");
  if (gaps.length === 0) return;
  const described = gaps.map((g) => {
    const label = COUNTERPARTY_LICENSE_KIND_LABELS[g.kind];
    if (g.status === "expired") return `${label}: expired ${g.expiresOn}`;
    if (g.status === "awaiting_verification") return `${label}: recorded, not yet verified`;
    return `${label}: none recorded`;
  });
  throw new BadRequestException(
    `${counterparty.name} can't be paid until its licences are in order. ${described.join("; ")}. Record and verify a current licence first.`,
  );
}

@Injectable()
export class CounterpartyLicensesService {
  /** Anyone with counterparty.license_record. Moves nothing until someone else verifies it. */
  async record(counterpartyId: string, input: RecordCounterpartyLicenseInput, actorUserId: string) {
    const today = lagosToday();
    if (input.issuedOn && input.issuedOn > input.expiresOn) {
      throw new BadRequestException("The issue date is after the expiry date.");
    }
    if (input.expiresOn < today) {
      throw new BadRequestException(`This licence expired on ${input.expiresOn}. Record the current one instead.`);
    }
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id: counterpartyId } });
      if (!counterparty || counterparty.deletedAt) throw new NotFoundException(`Counterparty "${counterpartyId}" not found.`);
      const license = await tx.counterpartyLicense.create({
        data: {
          counterpartyId,
          kind: input.kind,
          licenseNumber: input.licenseNumber,
          issuingAuthority: input.issuingAuthority,
          issuedOn: input.issuedOn ? asDate(input.issuedOn) : undefined,
          expiresOn: asDate(input.expiresOn),
          recordedByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty_license.recorded",
          entityType: "CounterpartyLicense",
          entityId: license.id,
          after: license as any,
        },
      });
      return license;
    });
  }

  /**
   * The second person: checks the certificate or the regulator's register
   * and says how. Never whoever recorded it (refused here, and by a CHECK).
   */
  async verify(licenseId: string, input: VerifyCounterpartyLicenseInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await this.lockAndFind(tx, licenseId);
      if (before.withdrawnAt) throw new BadRequestException("This licence was withdrawn, so it can't be verified.");
      if (before.verifiedAt) throw new ConflictException("This licence is already verified.");
      if (before.recordedByUserId === actorUserId) {
        throw new ForbiddenException("You recorded this licence, so someone else must verify it.");
      }
      const after = await tx.counterpartyLicense.update({
        where: { id: licenseId },
        data: { verifiedByUserId: actorUserId, verifiedAt: new Date(), verificationNote: input.note },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty_license.verified",
          entityType: "CounterpartyLicense",
          entityId: licenseId,
          before: before as any,
          after: after as any,
        },
      });
      return after;
    });
  }

  /**
   * A licence recorded in error, or one the regulator has suspended or
   * revoked. Takes effect at once: if it was the only current licence of a
   * required kind, payments to the counterparty stop.
   */
  async withdraw(licenseId: string, input: WithdrawCounterpartyLicenseInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await this.lockAndFind(tx, licenseId);
      if (before.withdrawnAt) throw new ConflictException("This licence is already withdrawn.");
      const after = await tx.counterpartyLicense.update({
        where: { id: licenseId },
        data: { withdrawnByUserId: actorUserId, withdrawnAt: new Date(), withdrawalReason: input.reason },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "counterparty_license.withdrawn",
          entityType: "CounterpartyLicense",
          entityId: licenseId,
          before: before as any,
          after: after as any,
        },
      });
      return after;
    });
  }

  /** Every licence on record, newest first, and where each required one stands today. */
  async list(counterpartyId: string) {
    const counterparty = await prisma.counterparty.findUnique({ where: { id: counterpartyId } });
    if (!counterparty) throw new NotFoundException(`Counterparty "${counterpartyId}" not found.`);
    const user = { select: { id: true, fullName: true } };
    const [licenses, requirements] = await Promise.all([
      prisma.counterpartyLicense.findMany({
        where: { counterpartyId },
        orderBy: [{ expiresOn: "desc" }, { recordedAt: "desc" }],
        include: { recordedByUser: user, verifiedByUser: user, withdrawnByUser: user },
      }),
      licenseRequirements(prisma, counterparty),
    ]);
    return { requirements, licenses };
  }

  // Locks the counterparty before reading the licence, the same row
  // assertLicensesCurrent share-locks, so a verification or withdrawal and
  // a payment's check never pass each other half-done.
  private async lockAndFind(tx: Prisma.TransactionClient, licenseId: string) {
    const found = await tx.counterpartyLicense.findUnique({ where: { id: licenseId }, select: { counterpartyId: true } });
    if (!found) throw new NotFoundException(`Licence "${licenseId}" not found.`);
    await tx.$queryRaw`SELECT "id" FROM "counterparties" WHERE "id" = ${found.counterpartyId} FOR UPDATE`;
    return tx.counterpartyLicense.findUniqueOrThrow({ where: { id: licenseId } });
  }
}
