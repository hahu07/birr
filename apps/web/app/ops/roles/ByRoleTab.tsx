"use client";

// One role at a time: who holds it, and every permission grouped by area,
// each set in place. An edit is only staged (StagedChangesBar sends the
// batch, with a reason, for the Board's approval); every control starts
// from the role's current grant.
import { useMemo, useState } from "react";
import type { GovernedActionPermission, GrantChange, Role, RolesOverview } from "../../../lib/ops-types";
import { areaLabel, grantOf, permissionLabel, settingLabel, settingOf, type GrantSetting } from "../../../lib/permission-labels";
import { Badge, Card, Input } from "@birr/ui";
import { stageKey } from "./staging";

export function ByRoleTab({
  overview,
  staged,
  onStage,
  canEdit,
}: {
  overview: RolesOverview;
  staged: Map<string, GrantChange>;
  onStage: (change: GrantChange) => void;
  canEdit: boolean;
}) {
  const [roleKey, setRoleKey] = useState(overview.roles[0]?.key ?? "");
  const role = overview.roles.find((r) => r.key === roleKey) ?? overview.roles[0];
  const stagedPerRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of staged.values()) counts.set(c.roleKey, (counts.get(c.roleKey) ?? 0) + 1);
    return counts;
  }, [staged]);

  if (!role) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <nav aria-label="Roles" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {overview.roles.map((r) => {
          const active = r.key === role.key;
          const people = overview.holders[r.key]?.length ?? 0;
          const changes = stagedPerRole.get(r.key) ?? 0;
          return (
            <button
              key={r.key}
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => setRoleKey(r.key)}
              className={`shrink-0 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                active ? "border-primary-300 bg-primary-50/70" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span className="block text-sm font-medium text-slate-900">{r.name}</span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                {people} {people === 1 ? "person" : "people"}
                {changes > 0 && <Badge tone="warning">{changes} staged</Badge>}
              </span>
            </button>
          );
        })}
      </nav>
      <RoleDetail key={role.key} role={role} overview={overview} staged={staged} onStage={onStage} canEdit={canEdit} />
    </div>
  );
}

function RoleDetail({
  role,
  overview,
  staged,
  onStage,
  canEdit,
}: {
  role: Role;
  overview: RolesOverview;
  staged: Map<string, GrantChange>;
  onStage: (change: GrantChange) => void;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [onlyGranted, setOnlyGranted] = useState(false);
  const holders = overview.holders[role.key] ?? [];
  const grantFor = (key: string) => role.rolePermissions.find((rp) => rp.permission.key === key);
  const effective = (p: GovernedActionPermission) => staged.get(stageKey({ roleKey: role.key, permissionKey: p.key })) ?? grantFor(p.key);

  const q = query.trim().toLowerCase();
  const visible = overview.permissions.filter((p) => {
    if (q && !`${permissionLabel(p)} ${p.key} ${areaLabel(p.category)}`.toLowerCase().includes(q)) return false;
    if (onlyGranted) {
      const g = effective(p);
      if (!g || (!g.canMaker && !g.canChecker)) return false;
    }
    return true;
  });
  const areas = [...new Set(visible.map((p) => p.category ?? ""))].sort((a, b) => areaLabel(a).localeCompare(areaLabel(b)));
  const grantedCount = overview.permissions.filter((p) => {
    const g = grantFor(p.key);
    return g && (g.canMaker || g.canChecker);
  }).length;

  return (
    <Card padded={false} className="min-w-0 overflow-hidden">
      <div className="border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{role.name}</h2>
            {role.description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{role.description}</p>}
          </div>
          <div className="flex gap-2">
            {role.key === "board_of_trustees" && <Badge tone="info">Approves access changes</Badge>}
            {role.key === "external_auditor" && <Badge tone="neutral">Read-only on approvals</Badge>}
          </div>
        </div>
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {holders.length} {holders.length === 1 ? "person holds" : "people hold"} this role
          </p>
          {holders.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No one holds it yet.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {holders.map((h) => (
                <li key={h.id} title={h.email} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-700">
                  {h.fullName}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3 sm:px-6">
        <Input
          aria-label="Search permissions"
          placeholder="Search permissions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full sm:w-72"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyGranted} onChange={(e) => setOnlyGranted(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Only what this role has
        </label>
        <span className="text-xs text-slate-500 sm:ml-auto">
          Has {grantedCount} of {overview.permissions.length}
          {!canEdit && " · view only"}
        </span>
      </div>

      {visible.length === 0 && <p className="px-6 py-8 text-center text-sm text-slate-500">No permissions match.</p>}

      {areas.map((area) => {
        const inArea = visible.filter((p) => (p.category ?? "") === area);
        return (
          <section key={area || "other"} aria-label={areaLabel(area)} className="border-b border-slate-100 last:border-b-0">
            <h3 className="bg-white px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6">{areaLabel(area)}</h3>
            <ul>
              {inArea.map((p) => (
                <PermissionRow
                  key={p.key}
                  role={role}
                  permission={p}
                  current={grantFor(p.key)}
                  staged={staged.get(stageKey({ roleKey: role.key, permissionKey: p.key }))}
                  onStage={onStage}
                  canEdit={canEdit}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </Card>
  );
}

function PermissionRow({
  role,
  permission,
  current,
  staged,
  onStage,
  canEdit,
}: {
  role: Role;
  permission: GovernedActionPermission;
  current: { canMaker: boolean; canChecker: boolean } | undefined;
  staged: GrantChange | undefined;
  onStage: (change: GrantChange) => void;
  canEdit: boolean;
}) {
  const approval = permission.requiresMakerChecker;
  const was = settingOf(current, approval);
  const now = settingOf(staged ?? current, approval);
  const options: GrantSetting[] = approval ? ["none", "proposes", "approves"] : ["none", "allowed"];
  const label = permissionLabel(permission);
  // The backend refuses these anyway; saying so here saves a round trip.
  const blocked = (option: GrantSetting) =>
    approval && role.key === "external_auditor" && option !== "none" ? "The External Auditor stays read-only on approval actions." : null;

  return (
    <li className={`flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${staged ? "bg-amber-50/70" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm text-slate-900">{label}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-mono">{permission.key}</span>
          <Badge tone={approval ? "info" : "neutral"}>{approval ? "Approval" : "Access"}</Badge>
          {staged && (
            <span className="font-medium text-amber-800">
              Was {settingLabel(was, approval)} ·{" "}
              <button type="button" className="underline" onClick={() => onStage({ roleKey: role.key, permissionKey: permission.key, ...(current ?? { canMaker: false, canChecker: false }) })}>
                Undo
              </button>
            </span>
          )}
        </p>
      </div>
      {canEdit ? (
        <div role="radiogroup" aria-label={`${label}, ${role.name}`} className="inline-flex shrink-0 self-start rounded-lg bg-slate-100 p-0.5 sm:self-auto">
          {options.map((option) => {
            const reason = blocked(option);
            const checked = now === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={Boolean(reason)}
                title={reason ?? undefined}
                onClick={() => onStage({ roleKey: role.key, permissionKey: permission.key, ...grantOf(option) })}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  checked ? (option === "none" ? "bg-white text-slate-700 shadow-sm" : "bg-white text-primary-800 shadow-sm") : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {settingLabel(option, approval)}
              </button>
            );
          })}
        </div>
      ) : (
        <span className={`shrink-0 text-xs font-medium ${now === "none" ? "text-slate-400" : "text-primary-800"}`}>{settingLabel(now, approval)}</span>
      )}
    </li>
  );
}
