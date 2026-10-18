"use client";

// Roles & Access — a live read of everything each staff role can do (GET
// /roles): the governed actions it may propose (maker) or approve
// (checker), and every plain access permission it holds. Since 2026-10-18
// every route's gate is a named permission in these same tables (no more
// role names scattered across controllers), so nothing here is
// hand-maintained.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize, humanizePermissionKey } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { Role } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  Card,
  IconKey,
  Select,
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
  const { can } = useStaffSession();

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
          {can("role.permission_change") && <ProposeGrantChange roles={roles} />}

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

type GrantSetting = "none" | "maker" | "checker";

// Propose changing one role's grant on one permission — the governed
// role.permission_change action. The Board approves it on the Approvals
// page; nothing here changes anyone's access directly. The backend
// refuses a change that would leave an approval action with nobody able to
// propose or approve it, give one role both sides, or give the External
// Auditor either side.
function uniquePermissions(roles: Role[]) {
  return [
    ...new Map(roles.flatMap((r) => r.rolePermissions.map((rp) => [rp.permission.key, rp.permission] as const))).values(),
  ].sort((a, b) => a.key.localeCompare(b.key));
}

function ProposeGrantChange({ roles }: { roles: Role[] }) {
  const permissions = uniquePermissions(roles);
  const [roleKey, setRoleKey] = useState("");
  const [permissionKey, setPermissionKey] = useState("");
  const [setting, setSetting] = useState<GrantSetting>("none");
  const { submit, submitting, sent, error, reset } = useProposeGrantChange();

  const permission = permissions.find((p) => p.key === permissionKey);
  const role = roles.find((r) => r.key === roleKey);

  if (sent) return <SentForApproval onAnother={reset} />;

  return (
    <Card className="mb-8">
      <ProposeHeader error={error} />
      <div className="flex flex-wrap items-end gap-3">
        <LabelledSelect id="grant-role" label="Role" value={roleKey} onChange={setRoleKey} className="w-52">
          <RoleOptions roles={roles} />
        </LabelledSelect>
        <LabelledSelect
          id="grant-permission"
          label="Permission"
          value={permissionKey}
          onChange={(key) => {
            setPermissionKey(key);
            setSetting("none");
          }}
          className="w-72"
        >
          <option value="">Choose a permission…</option>
          {permissions.map((p) => (
            <option key={p.key} value={p.key}>
              {humanizePermissionKey(p.key)}
              {p.requiresMakerChecker ? " (approval)" : ""}
            </option>
          ))}
        </LabelledSelect>
        <GrantSettingSelect permission={permission} value={setting} onChange={setSetting} />
        <Button
          disabled={!role || !permission || submitting}
          onClick={() => role && permission && submit(role.key, permission.key, setting)}
        >
          {submitting ? "Sending…" : "Send for approval"}
        </Button>
      </div>
      {role && permission && <CurrentGrant role={role} permission={permission} />}
    </Card>
  );
}

function RoleOptions({ roles }: { roles: Role[] }) {
  return (
    <>
      <option value="">Choose a role…</option>
      {roles.map((r) => (
        <option key={r.key} value={r.key}>
          {r.name}
        </option>
      ))}
    </>
  );
}

function ProposeHeader({ error }: { error: string | null }) {
  return (
    <>
      <h2 className="text-sm font-semibold text-slate-900">Propose a change</h2>
      <p className="mb-4 mt-0.5 text-xs text-slate-500">
        Change what one role may do. A Board member approves every change before it takes effect.
      </p>
      {error && (
        <Alert tone="danger" title="Couldn't send for approval" className="mb-4">
          {error}
        </Alert>
      )}
    </>
  );
}

function useProposeGrantChange() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(roleKey: string, permissionKey: string, setting: GrantSetting) {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({
          permissionKey: "role.permission_change",
          payload: { roleKey, permissionKey, canMaker: setting === "maker", canChecker: setting === "checker" },
        }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return { submit, submitting, sent, error, reset: () => setSent(false) };
}

function LabelledSelect({
  id,
  label,
  value,
  onChange,
  className,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-slate-700">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
        {children}
      </Select>
    </div>
  );
}

function SentForApproval({ onAnother }: { onAnother: () => void }) {
  return (
    <Alert tone="success" title="Sent for approval" className="mb-8">
      A Board member needs to approve this on the Approvals page before it takes effect.{" "}
      <button type="button" className="font-medium underline" onClick={onAnother}>
        Propose another
      </button>
    </Alert>
  );
}

type PermissionInfo = Role["rolePermissions"][number]["permission"];

function GrantSettingSelect({
  permission,
  value,
  onChange,
}: {
  permission: PermissionInfo | undefined;
  value: GrantSetting;
  onChange: (setting: GrantSetting) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="grant-setting" className="text-xs font-medium text-slate-700">
        New setting
      </label>
      <Select
        id="grant-setting"
        value={value}
        onChange={(e) => onChange(e.target.value as GrantSetting)}
        className="w-52"
        disabled={!permission}
      >
        {permission?.requiresMakerChecker ? (
          <>
            <option value="none">Neither</option>
            <option value="maker">Can propose</option>
            <option value="checker">Can approve</option>
          </>
        ) : (
          <>
            <option value="none">Not allowed</option>
            <option value="maker">Allowed</option>
          </>
        )}
      </Select>
    </div>
  );
}

// What the chosen role has on the chosen permission today.
function CurrentGrant({ role, permission }: { role: Role; permission: PermissionInfo }) {
  const grant = grantFor(role, permission.key);
  const label = permission.requiresMakerChecker
    ? grant?.canMaker
      ? "can propose"
      : grant?.canChecker
        ? "can approve"
        : "neither proposes nor approves"
    : grant?.canMaker
      ? "allowed"
      : "not allowed";
  return (
    <p className="mt-3 text-xs text-slate-600">
      {permission.description ?? humanizePermissionKey(permission.key)} — {humanize(role.key)} currently{" "}
      <span className="font-medium">{label}</span>.
      {role.key === "board_of_trustees" && " This would change the Board's own permissions."}
    </p>
  );
}
