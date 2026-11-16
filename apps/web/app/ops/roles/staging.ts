import type { GrantChange } from "../../../lib/ops-types";

/** One staged change per role and permission. */
export const stageKey = (change: Pick<GrantChange, "roleKey" | "permissionKey">) => `${change.roleKey}:${change.permissionKey}`;
