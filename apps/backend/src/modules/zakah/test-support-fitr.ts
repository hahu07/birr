import { randomInt } from "crypto";
import { prisma } from "@birr/db";

/**
 * A 4-digit season no campaign has used yet, well outside real Hijri years,
 * so a test never collides with a leftover draft from an earlier run.
 */
export async function unusedFitrSeason(): Promise<string> {
  for (;;) {
    const season = String(randomInt(2000, 10000));
    if (!(await prisma.zakahFitrCampaign.findFirst({ where: { season } }))) return season;
  }
}
