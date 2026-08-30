"use client";

// Roles & Access — a live read of the org's own maker/checker structure
// (packages/db/prisma/seed-data.ts, via GET /roles), plus the additional
// route-level access each role has that isn't a governed_actions
// permission at all (e.g. Compliance Officer can suspend a counterparty
// outright — no maker/checker involved, just a StaffRoleGuard check).
// That second half genuinely can't be read from the database — it's
// @RequiresStaffRole() decorators scattered across controllers — so it's
// hand-maintained here, same posture as NAV_GROUPS in app-shell.tsx.
// Keep ADDITIONAL_ACCESS in sync when a controller's @RequiresStaffRole
// grants change.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanizePermissionKey } from "../../../lib/format";
import type { Role } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Card,
  IconKey,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

// Display order mirrors seed-data.ts's own ordering intent (apex →
// committees → specialists → admin), not alphabetical — Role has no
// sortOrder column, so this is re-sorted client-side.
const ROLE_ORDER = [
  "mutawalli_officer",
  "board_of_trustees",
  "investment_committee",
  "shariah_board_member",
  "audit_committee",
  "compliance_officer",
  "legal_adviser",
  "external_auditor",
  "platform_admin",
];

// Only the five governed (requiresMakerChecker) permissions get a matrix
// column — waqf.view/compliance.report_export are plain reads/exports,
// not maker-checker gated, so they're covered under "Also has" instead.
const GOVERNED_PERMISSION_ORDER = [
  "asset.dispose",
  "distribution.approve",
  "investment.change",
  "beneficiary.criteria_update",
  "counterparty.onboard",
];

const ADDITIONAL_ACCESS: Record<string, string[]> = {
  mutawalli_officer: ["View any waqf's details"],
  board_of_trustees: ["View any waqf's details"],
  investment_committee: ["Register, update, or deregister a counterparty", "View any waqf's details"],
  shariah_board_member: [
    "Record Shariah approval on a counterparty (a precondition counterparty.onboard checks for)",
    "View any waqf's details",
  ],
  audit_committee: ["View any waqf's details"],
  compliance_officer: [
    "Set a counterparty's concentration limit",
    "Suspend or blacklist a counterparty",
    "View any waqf's details",
  ],
  legal_adviser: ["View any waqf's details"],
  external_auditor: ["Export compliance reports", "View any waqf's details"],
  platform_admin: [
    "Create new Birr staff accounts",
    "Set jurisdiction compliance policy sets",
    "Manage Birr's trustee license status per jurisdiction",
    "Set corpus & contribution minimums, installment terms",
    "Maintain the standard cause category catalog",
    "Approve or reject AI-suggested cause categories",
    "Manage payment provider credentials",
    "View any waqf's details",
  ],
};

function grantFor(role: Role, permissionKey: string) {
  return role.rolePermissions.find((rp) => rp.permission.key === permissionKey);
}

function GrantCell({ grant }: { grant: { canMaker: boolean; canChecker: boolean } | undefined }) {
  if (!grant || (!grant.canMaker && !grant.canChecker)) {
    return <span className="text-slate-300">—</span>;
  }
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {grant.canMaker && <Badge tone="warning">Maker</Badge>}
      {grant.canChecker && <Badge tone="success">Checker</Badge>}
    </div>
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Role[]>("/roles")
      .then((data) => {
        if (cancelled) return;
        const ordered = [...data].sort((a, b) => ROLE_ORDER.indexOf(a.key) - ROLE_ORDER.indexOf(b.key));
        setRoles(ordered);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconKey className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Roles &amp; Access</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            What each Birr staff role can propose, approve, and reach — maker proposes a governed action, checker
            approves or rejects it, and no one can be both on the same one.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load roles" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && roles === null && <Skeleton className="h-64 w-full" />}

      {roles && (
        <>
          <section className="mb-10">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Governed actions, at a glance</h2>
            <p className="mb-4 text-xs text-slate-500">
              Every one of these five requires a maker <em>and</em> a different person as checker.
            </p>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Permission</TableHeaderCell>
                  {roles.map((role) => (
                    <TableHeaderCell key={role.id} className="text-center">
                      {role.name}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {GOVERNED_PERMISSION_ORDER.map((permissionKey) => (
                  <TableRow key={permissionKey}>
                    <TableCell className="font-medium text-slate-800">
                      {humanizePermissionKey(permissionKey)}
                    </TableCell>
                    {roles.map((role) => (
                      <TableCell key={role.id} className="text-center">
                        <GrantCell grant={grantFor(role, permissionKey)} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section>
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Every role, in full</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {roles.map((role) => {
                const makerOf = role.rolePermissions.filter(
                  (rp) => rp.canMaker && GOVERNED_PERMISSION_ORDER.includes(rp.permission.key),
                );
                const checkerOf = role.rolePermissions.filter(
                  (rp) => rp.canChecker && GOVERNED_PERMISSION_ORDER.includes(rp.permission.key),
                );
                const isApex = role.key === "board_of_trustees";
                const isReadOnly = role.key === "external_auditor";

                return (
                  <Card key={role.id} tone={isApex ? "accent" : "neutral"} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">{role.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">{role.key}</p>
                      </div>
                      {isApex && <Badge tone="warning">Apex checker</Badge>}
                      {isReadOnly && <Badge tone="neutral">Read-only</Badge>}
                    </div>

                    {role.description && <p className="text-xs text-slate-600">{role.description}</p>}

                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Maker on
                      </p>
                      {makerOf.length === 0 ? (
                        <p className="text-xs italic text-slate-400">Nothing.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {makerOf.map((rp) => (
                            <span
                              key={rp.permission.id}
                              className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
                            >
                              {rp.permission.key}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Checker on
                      </p>
                      {checkerOf.length === 0 ? (
                        <p className="text-xs italic text-slate-400">Nothing.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {checkerOf.map((rp) => (
                            <span
                              key={rp.permission.id}
                              className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
                            >
                              {rp.permission.key}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Also has
                      </p>
                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                        {(ADDITIONAL_ACCESS[role.key] ?? []).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          <Alert tone="success" title="Maker ≠ checker is enforced by the database" className="mt-8">
            Even if one person holds a role that's both maker and checker somewhere above, a CHECK constraint on{" "}
            <code className="font-mono">governed_actions</code> rejects a self-approval outright — this table
            describes what's normally possible, not the individual-level guarantee.
          </Alert>
        </>
      )}
    </div>
  );
}
