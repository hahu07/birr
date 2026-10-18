import { Reflector } from "@nestjs/core";
import { accessPermissions } from "@birr/db/prisma/seed-data";
import { REQUIRES_PERMISSION_KEY } from "../../common/guards/permission.guard";
import { AiAgentsController } from "./ai-agents.controller";

// PermissionGuard's own mechanism is covered generically. What that can't
// catch is this route's gate drifting to the wrong roles — e.g. someone
// granting platform_admin agent_draft.publish as a convenience override,
// which would quietly break CLAUDE.md's explicit "Legal/Compliance
// sign-off specifically, not just any Birr staff member" rule for
// Bashir's publish step. This test exists to catch exactly that.
describe("AiAgentsController — publishDraft access gate", () => {
  test("POST /ai-agents/:name/drafts/:draftId/publish requires agent_draft.publish", () => {
    const requirement = new Reflector().get<{ side: string; permissionKey?: string }>(
      REQUIRES_PERMISSION_KEY,
      AiAgentsController.prototype.publishDraft,
    );
    expect(requirement).toEqual({ side: "maker", permissionKey: "agent_draft.publish" });
  });

  test("agent_draft.publish is granted to legal_adviser and compliance_officer, and nobody else", () => {
    const grant = accessPermissions.find((p) => p.key === "agent_draft.publish");
    expect([...(grant?.roles ?? [])].sort()).toEqual(["compliance_officer", "legal_adviser"]);
  });
});
