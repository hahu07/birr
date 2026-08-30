import { Injectable } from "@nestjs/common";
import { prisma } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";

// Signing (create()) is retired — see FoundationDeedsService, the
// Foundation-level replacement for this per-Waqf design. This service
// now only serves whatever WaqfDeed rows already exist historically;
// nothing writes a new one.
@Injectable()
export class WaqfDeedsService {
  // Staff-side / internal — unrestricted. Never expose this behind a
  // controller route reachable by a Founder session; see
  // findByWaqfIdForFounder below for that path.
  findByWaqfId(waqfId: string) {
    return prisma.waqfDeed.findUnique({ where: { waqfId } });
  }

  // Founder-Portal read-only visibility into their own waqf's signed
  // deed — the actual legal instrument appointing Birr as trustee, so
  // ownership must be verified before returning it, same as every other
  // founder-scoped read in this codebase. Returns null (not an empty
  // object) when the waqf isn't found, isn't theirs, or has no deed yet
  // — the controller turns that into a 404.
  async findByWaqfIdForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      return tx.waqfDeed.findUnique({ where: { waqfId } });
    });
  }
}
