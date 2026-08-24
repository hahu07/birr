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
});
