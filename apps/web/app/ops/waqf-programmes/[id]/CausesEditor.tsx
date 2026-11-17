"use client";

// The causes a waqf programme serves, from the cause catalog (2026-11-17,
// shared layer step 3/4). A new programme starts with its product's
// defaults; a Mutawalli Officer (waqf_programme.manage) may change them.
// A tag only: it moves no money. Saved through PUT /waqf-programmes/:id,
// which audits the before and after.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { useStaffSession } from "../../../../lib/staff-session";
import type { CauseCategory, WaqfProgramme } from "../../../../lib/ops-types";
import { Alert, Button } from "@birr/ui";

export function CausesEditor({ programme, onChange }: { programme: WaqfProgramme; onChange: () => void }) {
  const { can } = useStaffSession();
  const current = (programme.causes ?? []).map((c) => c.causeCategory);
  const [catalog, setCatalog] = useState<CauseCategory[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startEditing() {
    setError(null);
    try {
      setCatalog(await apiFetchJson<CauseCategory[]>("/cause-categories"));
      setChosen(new Set(current.map((c) => c.id)));
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetchJson(`/waqf-programmes/${programme.id}`, { method: "PUT", body: JSON.stringify({ causeCategoryIds: [...chosen] }) });
      setEditing(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      <p className="text-xs text-slate-500">
        Serves: {current.length > 0 ? current.map((c) => c.name).join(", ") : "no cause yet"}
        {can("waqf_programme.manage") && !editing && (
          <button type="button" className="ml-2 font-medium text-primary-700 hover:text-primary-800" onClick={() => void startEditing()}>
            Change
          </button>
        )}
      </p>
      {error && (
        <Alert tone="danger" title="Couldn't change the causes" className="mt-2">
          {error}
        </Alert>
      )}
      {editing && catalog && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {catalog.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={chosen.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setChosen(next);
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => void save()}>
              Save causes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
