"use client";

// Roles & Access — a live read of everything each staff role can do (GET
// /roles): the governed actions it may propose (maker) or approve
// (checker), and every plain access permission it holds. Since 2026-10-18
// every route's gate is a named permission in these same tables (no more
// role names scattered across controllers), so nothing here is
// hand-maintained.
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

  // Every governed (maker-checker) permission any role holds, grouped by
  // category so related actions sit together.
  const governed = [
    ...new Map(
      (roles ?? [])
        .flatMap((r) => r.rolePermissions.map((rp) => rp.permission))
        .filter((p) => p.requiresMakerChecker)
        .map((p) => [p.key, p]),
    ).values(),
  ].sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.key.localeCompare(b.key));

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
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
              Every one of these requires a maker <em>and</em> a different person as checker.
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
                {governed.map((permission) => (
                  <TableRow key={permission.key}>
                    <TableCell className="font-medium text-slate-800" title={permission.description ?? undefined}>
                      {humanizePermissionKey(permission.key)}
                    </TableCell>
                    {roles.map((role) => (
                      <TableCell key={role.id} className="text-center">
                        <GrantCell grant={grantFor(role, permission.key)} />
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
                const makerOf = role.rolePermissions.filter((rp) => rp.canMaker && rp.permission.requiresMakerChecker);
                const checkerOf = role.rolePermissions.filter((rp) => rp.canChecker && rp.permission.requiresMakerChecker);
                const canDo = role.rolePermissions
                  .filter((rp) => rp.canMaker && !rp.permission.requiresMakerChecker)
                  .sort((a, b) => a.permission.key.localeCompare(b.permission.key));
                const isApex = role.key === "board_of_trustees";
                const isReadOnly = role.key === "external_auditor";

                return (
                  <Card key={role.id} tone={isApex ? "accent" : "neutral"} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">{role.name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{role.key}</p>
                      </div>
                      {isApex && <Badge tone="warning">Apex checker</Badge>}
                      {isReadOnly && <Badge tone="neutral">Read-only</Badge>}
                    </div>

                    {role.description && <p className="text-xs text-slate-600">{role.description}</p>}

                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Maker on
                      </p>
                      {makerOf.length === 0 ? (
                        <p className="text-xs italic text-slate-500">Nothing.</p>
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
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Checker on
                      </p>
                      {checkerOf.length === 0 ? (
                        <p className="text-xs italic text-slate-500">Nothing.</p>
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
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Can also
                      </p>
                      {canDo.length === 0 ? (
                        <p className="text-xs italic text-slate-500">Nothing else.</p>
                      ) : (
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                          {canDo.map((rp) => (
                            <li key={rp.permission.id} title={rp.permission.key}>
                              {rp.permission.description ?? humanizePermissionKey(rp.permission.key)}
                            </li>
                          ))}
                        </ul>
                      )}
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
