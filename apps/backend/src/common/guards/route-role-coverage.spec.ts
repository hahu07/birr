import { readdirSync, statSync } from "fs";
import { join } from "path";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRES_STAFF_ROLE_KEY } from "./staff-role.guard";
import { REQUIRES_PERMISSION_KEY } from "./permission.guard";

/**
 * Deny-by-default check for write routes. Every non-GET route must either
 * declare who may call it (@RequiresStaffRole / @RequiresPermission) or be
 * listed in UNGATED_WRITE_ROUTES below with the reason it doesn't need a
 * staff-role gate. Found 2026-10-18: ~35 staff write routes (recording
 * proceeds, approving beneficiary nominations, creating vaults, ...) were
 * reachable by any active staff member of any role, including
 * external_auditor — this test exists so the next new route can't slip
 * through the same way without a deliberate entry here.
 *
 * Keys are "<METHOD> /<controller path>/<route path>".
 */
const FOUNDER_SELF_SERVICE = "Founder Portal self-service — authenticated by the Founder session, not a staff role";
const OWN_ACCOUNT = "acts only on the caller's own account/session";
const PUBLIC_GIVING = "public giving flow — no account by design";
const PROVIDER_WEBHOOK = "payment provider webhook — authenticated by the provider's signature";
const AGENT_API_KEY = "AI agent route — authenticated by that agent's own API key (verifyAiAgentApiKey)";

const UNGATED_WRITE_ROUTES: Record<string, string> = {
  // Staff routes deliberately open to any active staff member.
  "POST /conflict-of-interest-declarations": "any staff member may declare their own conflict; reviewing is compliance_officer-only",
  "PATCH /founder-requests/:id": "scoped by caseload instead — FounderRequestsService.assertStaffCanAccessWaqf",
  "POST /messages": "Founder/staff messaging, both sides; scoped inside MessagesController",
  "POST /invitations": "dual Founder/staff route; birr_staff invites are platform_admin-only, asserted in the handler",
  "POST /invitations/:id/revoke": "dual Founder/staff route; birr_staff invites are platform_admin-only, asserted in InvitationsService.revoke",

  "POST /ai-agents/:name/generate-image": AGENT_API_KEY,
  "POST /ai-agents/:name/drafts": AGENT_API_KEY,

  "POST /birr-staff/login": OWN_ACCOUNT,
  "POST /birr-staff/login/mfa": OWN_ACCOUNT,
  "POST /birr-staff/logout": OWN_ACCOUNT,
  "POST /birr-staff/me/mfa/enroll": OWN_ACCOUNT,
  "POST /birr-staff/me/mfa/enroll/confirm": OWN_ACCOUNT,
  "POST /birr-staff/me/whatsapp/request-otp": OWN_ACCOUNT,
  "POST /birr-staff/me/whatsapp/verify-otp": OWN_ACCOUNT,
  "POST /notifications/:id/read": OWN_ACCOUNT,
  "POST /notifications/read-all": OWN_ACCOUNT,
  "PUT /notifications/preferences/:category": OWN_ACCOUNT,
  "POST /notifications/mark-read-for-entity": OWN_ACCOUNT,
  "POST /invitations/accept": "the invitation token itself is the credential",
  "POST /funnel-events": "anonymous sign-up funnel analytics",

  "POST /founders/sign-up": FOUNDER_SELF_SERVICE,
  "POST /founders/resend-verification-email": FOUNDER_SELF_SERVICE,
  "POST /founders/request-password-reset": FOUNDER_SELF_SERVICE,
  "POST /founders/reset-password": FOUNDER_SELF_SERVICE,
  "POST /founders/login": FOUNDER_SELF_SERVICE,
  "POST /founders/login/mfa": FOUNDER_SELF_SERVICE,
  "POST /founders/me/mfa/enroll": FOUNDER_SELF_SERVICE,
  "POST /founders/me/mfa/enroll/confirm": FOUNDER_SELF_SERVICE,
  "POST /founders/logout": FOUNDER_SELF_SERVICE,
  "POST /founders/establish": FOUNDER_SELF_SERVICE,
  "POST /founders/onboarding/purpose-suggestion": FOUNDER_SELF_SERVICE,
  "POST /founders/whatsapp/request-otp": FOUNDER_SELF_SERVICE,
  "POST /founders/whatsapp/verify-otp": FOUNDER_SELF_SERVICE,
  "POST /foundations": FOUNDER_SELF_SERVICE,
  "POST /foundation-deeds": FOUNDER_SELF_SERVICE,
  "POST /founder-requests": FOUNDER_SELF_SERVICE,
  "POST /cause-category-suggestions": FOUNDER_SELF_SERVICE,
  "POST /beneficiary-nominations": FOUNDER_SELF_SERVICE,
  "POST /beneficiary-nominations/bulk": FOUNDER_SELF_SERVICE,
  "POST /waqfs": FOUNDER_SELF_SERVICE,
  "POST /waqfs/:id/increase-corpus-target": FOUNDER_SELF_SERVICE,
  "POST /waqf-causes/select": FOUNDER_SELF_SERVICE,
  "POST /waqf-causes/:id/unselect": FOUNDER_SELF_SERVICE,
  "POST /waqf-causes/:id/allocate": FOUNDER_SELF_SERVICE,
  "POST /contributions": FOUNDER_SELF_SERVICE,
  "POST /contributions/:id/verify": FOUNDER_SELF_SERVICE,

  "POST /vault-contributions": PUBLIC_GIVING,
  "POST /vault-contributions/:id/verify": PUBLIC_GIVING,
  "POST /webhooks/stripe": PROVIDER_WEBHOOK,
  "POST /webhooks/paystack": PROVIDER_WEBHOOK,
  "POST /webhooks/stablecoin": PROVIDER_WEBHOOK,
};

const MODULES_DIR = join(__dirname, "..", "..", "modules");

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith(".controller.ts") ? [full] : [];
  });
}

function joinPath(...parts: (string | string[] | undefined)[]): string {
  const segments = parts
    .map((p) => (Array.isArray(p) ? p[0] : p) ?? "")
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return "/" + segments.join("/");
}

interface WriteRoute {
  key: string;
  gated: boolean;
}

function collectWriteRoutes(): WriteRoute[] {
  const routes: WriteRoute[] = [];
  for (const file of controllerFiles(MODULES_DIR)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value !== "function") continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, value) as string | string[] | undefined;
      if (controllerPath === undefined) continue;
      const proto = (value as { prototype: Record<string, unknown> }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        const handler = proto[name];
        if (typeof handler !== "function") continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined || method === RequestMethod.GET) continue;
        const routePath = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        routes.push({
          key: `${RequestMethod[method]} ${joinPath(controllerPath, routePath)}`,
          gated:
            Reflect.getMetadata(REQUIRES_STAFF_ROLE_KEY, handler) !== undefined ||
            Reflect.getMetadata(REQUIRES_PERMISSION_KEY, handler) !== undefined,
        });
      }
    }
  }
  return routes;
}

describe("write-route role coverage", () => {
  const routes = collectWriteRoutes();

  test("finds the backend's controllers", () => {
    // Guards against the scan silently finding nothing (e.g. a moved
    // modules directory), which would make the test below pass vacuously.
    expect(routes.length).toBeGreaterThan(100);
  });

  test("every write route declares a role/permission or is a listed exception", () => {
    const missing = routes.filter((r) => !r.gated && !(r.key in UNGATED_WRITE_ROUTES)).map((r) => r.key);
    expect(missing).toEqual([]);
  });

  test("every listed exception is still a real, still-ungated route", () => {
    const ungated = new Set(routes.filter((r) => !r.gated).map((r) => r.key));
    const stale = Object.keys(UNGATED_WRITE_ROUTES).filter((key) => !ungated.has(key));
    expect(stale).toEqual([]);
  });
});
