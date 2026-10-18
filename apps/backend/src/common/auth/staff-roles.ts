import { BirrStaffRole } from "@birr/db";

// A staff member holds one or more roles (birr_staff_roles, 2026-10-18).
// Small shared helpers so every query and response treats them the same way.

/** Prisma `where` fragment: the staff member holds at least one of these roles. */
export const holdsAnyRole = (...roles: BirrStaffRole[]) => ({ roles: { some: { role: { in: roles } } } });

/** Prisma `include`/`select` fragment loading just the role names. */
export const ROLE_NAMES = { roles: { select: { role: true }, orderBy: { role: "asc" as const } } };

/** Flattens loaded role rows to a plain list, e.g. ["legal_adviser", "compliance_officer"]. */
export const roleNames = (staff: { roles: { role: BirrStaffRole }[] }): BirrStaffRole[] => staff.roles.map((r) => r.role);
