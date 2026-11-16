import { BadRequestException } from "@nestjs/common";
import { BirrStaffRole, Prisma, prisma } from "@birr/db";
import { holdsAnyRole } from "../../common/auth/staff-roles";

/**
 * One role's desired end state on one permission. For an approval
 * (maker-checker) permission, canMaker = may propose and canChecker = may
 * approve; for a plain access permission canMaker = allowed and
 * canChecker is always false.
 */
export interface GrantChange {
  roleKey: string;
  permissionKey: string;
  canMaker: boolean;
  canChecker: boolean;
}

/**
 * role.permission_change's payload (owner's decisions, 2026-11-16): one
 * or more grant changes, approved or rejected together, with the
 * proposer's reason. Proposals made before then carried a single change
 * and no reason; they're still read (reason null) so any left pending
 * stay decidable.
 */
export interface PermissionChangeRequest {
  changes: GrantChange[];
  reason: string | null;
}

export const PERMISSION_CHANGE_REASON_MIN = 10;
export const PERMISSION_CHANGE_REASON_MAX = 1000;
export const PERMISSION_CHANGE_MAX = 50;

function parseChange(raw: unknown): GrantChange {
  const { roleKey, permissionKey, canMaker, canChecker } = (raw ?? {}) as Record<string, unknown>;
  if (typeof roleKey !== "string" || !roleKey || typeof permissionKey !== "string" || !permissionKey) {
    throw new BadRequestException("Each change needs a role and a permission.");
  }
  if (typeof canMaker !== "boolean" || typeof canChecker !== "boolean") {
    throw new BadRequestException("canMaker and canChecker must both be true or false.");
  }
  return { roleKey, permissionKey, canMaker, canChecker };
}

/** Reads either payload shape. A new proposal must carry a reason (requireReason). */
export function parsePermissionChangePayload(payload: unknown, options: { requireReason: boolean }): PermissionChangeRequest {
  const body = (payload ?? {}) as Record<string, unknown>;
  const changes = Array.isArray(body.changes) ? body.changes.map(parseChange) : [parseChange(body)];
  if (changes.length === 0) throw new BadRequestException("Choose at least one change.");
  if (changes.length > PERMISSION_CHANGE_MAX) {
    throw new BadRequestException(`At most ${PERMISSION_CHANGE_MAX} changes can go for approval together.`);
  }
  const seen = new Set<string>();
  for (const c of changes) {
    const pair = `${c.roleKey}:${c.permissionKey}`;
    if (seen.has(pair)) throw new BadRequestException(`${c.roleKey} on ${c.permissionKey} appears twice. Keep one.`);
    seen.add(pair);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (options.requireReason) {
    if (reason.length < PERMISSION_CHANGE_REASON_MIN) {
      throw new BadRequestException("Say why these changes are needed. The Board sees it, and it's kept in the audit trail.");
    }
    if (reason.length > PERMISSION_CHANGE_REASON_MAX) {
      throw new BadRequestException(`Keep the reason under ${PERMISSION_CHANGE_REASON_MAX} characters.`);
    }
  }
  return { changes, reason: reason || null };
}

export interface ChangeCheck extends GrantChange {
  roleName: string | null;
  permissionDescription: string | null;
  requiresMakerChecker: boolean;
  before: { canMaker: boolean; canChecker: boolean };
  /** Why this change can't be made, or null when it can. */
  problem: string | null;
  /** Active staff holding the role, whose access this changes. */
  affectedPeople: number;
}

/**
 * The guard rails on editing grants (owner's decisions, 2026-10-18), for a
 * whole batch. Every permission is editable, but no change may:
 *  - give a role both "propose" and "approve" on one approval action;
 *  - give external_auditor either side of an approval action;
 *  - give "approve" on a plain access permission (it has no approve side);
 * and the batch's combined end state may not leave an approval action
 * with nobody active able to propose it, or nobody able to approve it (a
 * lock-out, this editor included). Judged on the end state, so moving an
 * approver from one role to another in one batch is fine where removing
 * it first on its own would not be.
 *
 * Reads only. The caller locks (onApprove takes an advisory lock per
 * touched permission) when it acts on the result.
 */
export async function checkPermissionChanges(changes: GrantChange[], db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ChangeCheck[]> {
  const [roles, permissions] = await Promise.all([
    db.role.findMany({ where: { key: { in: [...new Set(changes.map((c) => c.roleKey))] } } }),
    db.permission.findMany({ where: { key: { in: [...new Set(changes.map((c) => c.permissionKey))] } } }),
  ]);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));
  const grants = permissions.length
    ? await db.rolePermission.findMany({
        where: { permissionId: { in: permissions.map((p) => p.id) } },
        select: { permissionId: true, canMaker: true, canChecker: true, role: { select: { key: true } } },
      })
    : [];
  const grantOf = (roleKey: string, permissionId: string) => grants.find((g) => g.permissionId === permissionId && g.role.key === roleKey);

  const peopleCache = new Map<string, number>();
  const peopleIn = async (roleKey: string) => {
    if (!peopleCache.has(roleKey)) {
      peopleCache.set(roleKey, await db.birrStaff.count({ where: { status: "active", ...holdsAnyRole(roleKey as BirrStaffRole) } }));
    }
    return peopleCache.get(roleKey)!;
  };

  const checks: ChangeCheck[] = [];
  for (const change of changes) {
    const role = roleByKey.get(change.roleKey);
    const permission = permissionByKey.get(change.permissionKey);
    const current = permission ? grantOf(change.roleKey, permission.id) : undefined;
    const before = { canMaker: current?.canMaker ?? false, canChecker: current?.canChecker ?? false };
    let problem: string | null = null;
    if (!role) problem = `Unknown role "${change.roleKey}".`;
    else if (!permission) problem = `Unknown permission "${change.permissionKey}".`;
    else if (before.canMaker === change.canMaker && before.canChecker === change.canChecker) {
      problem = `${role.name} already has exactly that on ${permission.key}.`;
    } else if (!permission.requiresMakerChecker && change.canChecker) {
      problem = `${permission.key} isn't an approval action — a role can only be allowed to do it or not.`;
    } else if (permission.requiresMakerChecker && change.canMaker && change.canChecker) {
      problem = `A role can't both propose and approve ${permission.key}.`;
    } else if (permission.requiresMakerChecker && role.key === "external_auditor" && (change.canMaker || change.canChecker)) {
      problem = "The External Auditor stays read-only on approval actions, so they stay independent of what they audit.";
    }
    checks.push({
      ...change,
      roleName: role?.name ?? null,
      permissionDescription: permission?.description ?? null,
      requiresMakerChecker: permission?.requiresMakerChecker ?? false,
      before,
      problem,
      affectedPeople: role ? await peopleIn(role.key) : 0,
    });
  }

  // Lock-outs, on each touched approval permission's combined end state.
  for (const permission of permissions.filter((p) => p.requiresMakerChecker)) {
    const touched = checks.filter((c) => c.permissionKey === permission.key);
    const endState = new Map<string, { canMaker: boolean; canChecker: boolean }>();
    for (const g of grants.filter((g) => g.permissionId === permission.id)) endState.set(g.role.key, { canMaker: g.canMaker, canChecker: g.canChecker });
    for (const c of touched.filter((c) => roleByKey.has(c.roleKey))) endState.set(c.roleKey, { canMaker: c.canMaker, canChecker: c.canChecker });

    for (const [side, label] of [["canMaker", "propose"], ["canChecker", "approve"]] as const) {
      const rolesWithSide = [...endState].filter(([, grant]) => grant[side]).map(([roleKey]) => roleKey as BirrStaffRole);
      const holders = rolesWithSide.length ? await db.birrStaff.count({ where: { status: "active", ...holdsAnyRole(...rolesWithSide) } }) : 0;
      if (holders > 0) continue;
      const message = `That would leave nobody active able to ${label} ${permission.key} — it could never be ${label === "propose" ? "proposed" : "approved"} again.`;
      // Blame the changes that take this side away.
      for (const c of touched) if (!c.problem && c.before[side] && !c[side]) c.problem = message;
    }
  }
  return checks;
}

/** Refuses the batch when any change has a problem; returns the checks otherwise. */
export async function assertPermissionChangesAllowed(changes: GrantChange[], db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ChangeCheck[]> {
  const checks = await checkPermissionChanges(changes, db);
  const failed = checks.find((c) => c.problem);
  if (failed) throw new BadRequestException(failed.problem);
  return checks;
}

/** "can propose", "can approve", "allowed"… for summaries. */
export function describeGrant(grant: { canMaker: boolean; canChecker: boolean }, requiresMakerChecker: boolean): string {
  if (!requiresMakerChecker) return grant.canMaker ? "allowed" : "not allowed";
  return grant.canMaker ? "can propose" : grant.canChecker ? "can approve" : "neither proposes nor approves";
}
