"use client";

// Every permission, with who may propose and approve it (an approval
// action) or who has it (plain access). Replaces the old nine-column grid,
// which showed approval actions only.
import { useState } from "react";
import type { RolesOverview } from "../../../lib/ops-types";
import { areaLabel, permissionLabel } from "../../../lib/permission-labels";
import { Badge, Card, Input, Select } from "@birr/ui";

export function ByPermissionTab({ overview }: { overview: RolesOverview }) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("");
  const [type, setType] = useState<"" | "approval" | "access">("");

  const areas = [...new Set(overview.permissions.map((p) => p.category ?? ""))].sort((a, b) => areaLabel(a).localeCompare(areaLabel(b)));
  const q = query.trim().toLowerCase();
  const rows = overview.permissions
    .filter((p) => !q || `${permissionLabel(p)} ${p.key}`.toLowerCase().includes(q))
    .filter((p) => !area || (p.category ?? "") === area)
    .filter((p) => !type || (type === "approval") === p.requiresMakerChecker)
    .sort((a, b) => areaLabel(a.category).localeCompare(areaLabel(b.category)) || permissionLabel(a).localeCompare(permissionLabel(b)));

  const rolesWith = (key: string, side: "canMaker" | "canChecker") =>
    overview.roles.filter((r) => r.rolePermissions.some((rp) => rp.permission.key === key && rp[side]));

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3 sm:px-6">
        <Input aria-label="Search permissions" placeholder="Search permissions…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full sm:w-72" />
        <Select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)} className="w-full sm:w-48">
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {areaLabel(a)}
            </option>
          ))}
        </Select>
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-full sm:w-44">
          <option value="">Approval and access</option>
          <option value="approval">Approval actions</option>
          <option value="access">Access</option>
        </Select>
        <span className="text-xs text-slate-500 sm:ml-auto">
          {rows.length} of {overview.permissions.length}
        </span>
      </div>

      {rows.length === 0 && <p className="px-6 py-8 text-center text-sm text-slate-500">No permissions match.</p>}

      <ul className="divide-y divide-slate-100">
        {rows.map((p) => {
          const approval = p.requiresMakerChecker;
          return (
            <li key={p.key} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{permissionLabel(p)}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{areaLabel(p.category)}</span>
                  <span className="font-mono">{p.key}</span>
                  <Badge tone={approval ? "info" : "neutral"}>{approval ? "Approval" : "Access"}</Badge>
                </p>
              </div>
              <div className="space-y-1.5 text-xs">
                {approval ? (
                  <>
                    <RoleChips label="Proposes" roles={rolesWith(p.key, "canMaker").map((r) => r.name)} />
                    <RoleChips label="Approves" roles={rolesWith(p.key, "canChecker").map((r) => r.name)} />
                  </>
                ) : (
                  <RoleChips label="Has it" roles={rolesWith(p.key, "canMaker").map((r) => r.name)} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RoleChips({ label, roles }: { label: string; roles: string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="w-16 shrink-0 font-medium text-slate-500">{label}</span>
      {roles.length === 0 ? (
        <span className="text-slate-400">No role</span>
      ) : (
        roles.map((name) => (
          <span key={name} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700">
            {name}
          </span>
        ))
      )}
    </div>
  );
}
