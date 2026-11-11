import { roles, permissions, rolePermissions } from "@birr/db/prisma/seed-data";

// Regression coverage for the segregation-of-duties role set CLAUDE.md
// names explicitly (Mutawalli Officer, Board of Trustees, Shariah
// Supervisory Board, Investment Committee, Audit Committee, Risk &
// Compliance, Legal Adviser, External Auditor). Asserts the design intent
// behind board_of_trustees/external_auditor directly against the seed
// data, not just that migrate/seed run without error.
describe("seed role data — segregation of duties", () => {
  const roleKeys = roles.map((r) => r.key);

  it("includes every birr_staff role CLAUDE.md names", () => {
    expect(roleKeys).toEqual(
      expect.arrayContaining([
        "mutawalli_officer",
        "board_of_trustees",
        "investment_committee",
        "shariah_board_member",
        "audit_committee",
        "compliance_officer",
        "legal_adviser",
        "external_auditor",
      ]),
    );
  });

  it("never grants external_auditor maker or checker rights on any maker-checker gated permission", () => {
    const governedPermissionKeys = new Set<string>(permissions.filter((p) => p.requiresMakerChecker).map((p) => p.key));
    const grants = rolePermissions.external_auditor ?? {};
    for (const [permissionKey, grant] of Object.entries(grants)) {
      if (!governedPermissionKeys.has(permissionKey)) continue;
      expect(grant.canMaker).not.toBe(true);
      expect(grant.canChecker).not.toBe(true);
    }
  });

  it("gives board_of_trustees checker (never maker) standing on every maker-checker gated permission", () => {
    const governedPermissionKeys = ["asset.dispose", "distribution.approve", "investment.change", "beneficiary.criteria_update"];
    const grants = rolePermissions.board_of_trustees ?? {};
    for (const key of governedPermissionKeys) {
      expect(grants[key]?.canChecker).toBe(true);
      expect(grants[key]?.canMaker).not.toBe(true);
    }
  });

  // Owner's decisions, 2026-11-11: Shariah rulings are approved by the
  // Shariah board alone, and the prices that set the nisab by Compliance
  // alone — not the Board of Trustees, unlike most governed actions.
  it("gives each zakah governed action exactly the proposer and approver the owner chose", () => {
    const holders = (key: string, side: "canMaker" | "canChecker") =>
      Object.entries(rolePermissions)
        .filter(([, grants]) => grants[key]?.[side])
        .map(([role]) => role)
        .sort();
    expect(holders("zakah.ruleset_approve", "canMaker")).toEqual(["mutawalli_officer"]);
    expect(holders("zakah.ruleset_approve", "canChecker")).toEqual(["shariah_board_member"]);
    expect(holders("zakah.metal_price_set", "canMaker")).toEqual(["investment_committee"]);
    expect(holders("zakah.metal_price_set", "canChecker")).toEqual(["compliance_officer"]);
    expect(holders("zakah.distribution_approve", "canMaker")).toEqual(["mutawalli_officer"]);
    expect(holders("zakah.distribution_approve", "canChecker")).toEqual(["compliance_officer", "shariah_board_member"]);
    expect(holders("zakah.distribution_mark_paid", "canMaker")).toEqual(["mutawalli_officer"]);
    expect(holders("zakah.distribution_mark_paid", "canChecker")).toEqual(["audit_committee", "compliance_officer"]);
    expect(holders("zakah.refund_approve", "canMaker")).toEqual(["compliance_officer"]);
    expect(holders("zakah.refund_approve", "canChecker")).toEqual(["board_of_trustees"]);
    expect(holders("zakah.refund_mark_paid", "canMaker")).toEqual(["mutawalli_officer"]);
    expect(holders("zakah.refund_mark_paid", "canChecker")).toEqual(["audit_committee", "compliance_officer"]);
    expect(holders("zakah.fitr_campaign_approve", "canMaker")).toEqual(["mutawalli_officer"]);
    expect(holders("zakah.fitr_campaign_approve", "canChecker")).toEqual(["shariah_board_member"]);
    // AML holds: either may freeze; only Compliance may release.
    expect(holders("zakah.payment_hold", "canMaker")).toEqual(["compliance_officer", "mutawalli_officer"]);
    expect(holders("zakah.payment_release", "canMaker")).toEqual(["compliance_officer"]);
  });

  // The permanent version of what the two tests above check by hand for
  // two specific roles — every role, every governed permission. Since
  // BirrStaff.staffRole is a single field (one role per person, enforced
  // by the unique constraint on userId), a role granting both canMaker
  // and canChecker on the same permission *is* the individual-level
  // maker-checker bug CLAUDE.md warns about ("a single person could
  // both propose and approve") — there's no second role for that person
  // to hide behind. This is the guardrail that catches it the moment a
  // future edit to rolePermissions introduces one, rather than relying
  // on a human reviewer to notice.
  it("never grants any single role both canMaker and canChecker on the same maker-checker gated permission", () => {
    const governedPermissionKeys = new Set<string>(permissions.filter((p) => p.requiresMakerChecker).map((p) => p.key));
    for (const [roleKey, grants] of Object.entries(rolePermissions)) {
      for (const [permissionKey, grant] of Object.entries(grants)) {
        if (!governedPermissionKeys.has(permissionKey)) continue;
        if (grant.canMaker && grant.canChecker) {
          throw new Error(
            `Role "${roleKey}" grants both canMaker and canChecker on "${permissionKey}" — a single person in ` +
              `this role could propose and approve their own action. Split the grant across two roles instead.`,
          );
        }
      }
    }
  });
});
