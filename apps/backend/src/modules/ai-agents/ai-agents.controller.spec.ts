import { Reflector } from "@nestjs/core";
import { REQUIRES_STAFF_ROLE_KEY } from "../../common/guards/staff-role.guard";
import { AiAgentsController } from "./ai-agents.controller";

// StaffRoleGuard's own mechanism (any-one-of-several-roles allowed,
// everyone else rejected) is already covered generically in
// staff-role.guard.spec.ts. What that can't catch is this route's own
// decorator drifting to the wrong roles — e.g. someone adding
// platform_admin back as a convenience override, which would quietly
// break CLAUDE.md's explicit "Legal/Compliance sign-off specifically,
// not just any Birr staff member" rule for Bashir's publish step. This
// test exists to catch exactly that regression.
describe("AiAgentsController — publishDraft role gate", () => {
  test("POST /ai-agents/:name/drafts/:draftId/publish requires legal_adviser or compliance_officer, and nothing else", () => {
    const reflector = new Reflector();
    const roles = reflector.get<string[]>(REQUIRES_STAFF_ROLE_KEY, AiAgentsController.prototype.publishDraft);
    expect(roles).toEqual(["legal_adviser", "compliance_officer"]);
  });
});
