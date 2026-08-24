import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { prisma, Prisma, WaqfType } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { withFounderScope } from "../../common/db/founder-scope";
import { TrusteeLicensesService } from "../trustee-licenses/trustee-licenses.service";

export class CreateWaqfInput {
  @IsString()
  name!: string;

  @IsEnum(WaqfType)
  type!: WaqfType;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsString()
  jurisdiction!: string;

  @IsString()
  foundationId!: string;
}

@Injectable()
export class WaqfsService {
  constructor(private readonly trusteeLicenses: TrusteeLicensesService) {}

  /**
   * Core creation logic, transactional — shared by createSelfService()
   * below. Not exposed directly behind a controller route: every public
   * caller goes through createSelfService() so the ownership check
   * always runs first.
   *
   * A Waqf's founder relationship is derived transitively via
   * foundationId -> foundation_founders -> founderId (see
   * foundations/foundations.service.ts) — a Waqf without a foundationId
   * would be invisible to the founder_isolation RLS policy
   * (packages/db/prisma/migrations/20260802211506_drop_waqf_founders_and_rewrite_founder_isolation)
   * for anyone but Birr's own (unscoped) backend connection, which is
   * exactly why foundationId is a required (NOT NULL) FK, not optional.
   */
  async create(input: CreateWaqfInput, tx: Prisma.TransactionClient) {
    const foundation = await tx.foundation.findUnique({
      where: { id: input.foundationId },
    });
    if (!foundation) {
      throw new NotFoundException(`Unknown foundation id: ${input.foundationId}`);
    }

    return tx.waqf.create({
      data: {
        name: input.name,
        type: input.type,
        purpose: input.purpose,
        jurisdiction: input.jurisdiction,
        foundationId: input.foundationId,
      },
    });
  }

  /**
   * Self-service Waqf Fund establishment — a donor creates it directly,
   * live immediately, no maker-checker gate. The act of creating it is
   * how the donor agrees Birr becomes Mutawalli over it; ongoing
   * governance (asset disposal, distributions, investment changes,
   * beneficiary-criteria changes) stays exclusively Birr-staff-mediated
   * through governed_actions, unchanged.
   *
   * The ownership check below — the Foundation must actually belong to
   * the calling founder, via the same foundationFounders join the RLS
   * policy already uses — is the security-critical line here: without
   * it, any founder could create a waqf under any other founder's
   * Foundation just by guessing/enumerating a foundationId.
   */
  async createSelfService(input: CreateWaqfInput & { founderId: string }) {
    return prisma.$transaction(async (tx) => {
      await assertFounderVerified(tx, input.founderId);

      const foundation = await tx.foundation.findFirst({
        where: { id: input.foundationId, foundationFounders: { some: { founderId: input.founderId } } },
      });
      if (!foundation) {
        throw new ForbiddenException("This foundation doesn't belong to you.");
      }

      const waqf = await this.create(input, tx);

      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorFounderId: input.founderId,
          action: "waqf.created",
          entityType: "Waqf",
          entityId: waqf.id,
          after: waqf as any,
        },
      });

      return waqf;
    });
  }

  async findById(id: string) {
    // Founder Portal's Waqf Fund detail page (app/portfolio/[id]) needs
    // the Foundation it belongs to for its "Part of {foundation.name}"
    // context line — purely additive, same as list()'s existing include.
    // waqfDeed is included so the onboarding wizard's step-4 page and
    // status checks can read deed state straight off this response.
    const waqf = await prisma.waqf.findUnique({ where: { id }, include: { foundation: true, waqfDeed: true } });
    return waqf ? this.withTrusteeLicenseStatus(waqf) : waqf;
  }

  /**
   * Flags, never blocks — see TrusteeLicense's own schema comment.
   * Additive field on the response so the Ops Console (and, if it ever
   * wants to, the Founder Portal) can surface it without a second
   * round-trip; nothing in the create path checks or reacts to it.
   */
  private async withTrusteeLicenseStatus<T extends { jurisdiction: string }>(waqf: T) {
    const trusteeLicenseStatus = await this.trusteeLicenses.statusForJurisdiction(waqf.jurisdiction);
    return { ...waqf, trusteeLicenseStatus };
  }

  /**
   * Founder-session-scoped counterpart to findById() — used by
   * WaqfsController.findById() when a Founder Portal session is
   * present, so a signed-in Founder can't read another Founder's waqf
   * by id. Same withFounderScope pattern as list(): the app-layer WHERE
   * clause and the founder_isolation RLS policy are both genuinely
   * scoped to founderId for this request, not just the WHERE clause
   * alone. Returns null (not throw) on no match — the controller turns
   * that into a 404, deliberately indistinguishable from "id doesn't
   * exist at all."
   */
  findByIdForFounder(id: string, founderId: string) {
    return withFounderScope(founderId, (tx) =>
      tx.waqf.findFirst({
        where: { id, foundation: { foundationFounders: { some: { founderId } } } },
        include: { foundation: true, waqfDeed: true },
      }),
    );
  }

  /**
   * When founderId is given, this also sets the app.current_founder_id
   * session variable that founder_isolation
   * (packages/db/prisma/migrations/20260802211506_drop_waqf_founders_and_rewrite_founder_isolation)
   * reads — so the WHERE clause below (app-layer) and the RLS policy
   * (DB-layer) are both genuinely enforcing the same scope for this
   * request, not just the WHERE clause alone. The founder relationship
   * is transitive via foundationId -> foundation_founders, not a direct
   * join table.
   */
  list(founderId?: string) {
    if (!founderId) {
      return prisma.waqf.findMany({
        include: { foundation: true },
        orderBy: { createdAt: "desc" },
      });
    }
    return withFounderScope(founderId, (tx) =>
      tx.waqf.findMany({
        where: { foundation: { foundationFounders: { some: { founderId } } } },
        include: { foundation: true },
        orderBy: { createdAt: "desc" },
      }),
    );
  }
}
