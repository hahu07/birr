"use client";

// The standard cause catalog Birr's product team maintains — a Founder
// picks from these, self-service, for their own Waqf Fund (see
// app/(founder)/portfolio/[id]/CausesSection.tsx). Writes are
// platform_admin-only (backend-enforced; this page also hides the forms
// for other roles, same posture as the Jurisdictions/Platform Settings
// pages). Retire, not delete — a Founder may already have selected an
// entry, and their waqf's own copy of its name/description keeps
// displaying regardless of what happens here afterward; usageCount (see
// CauseCategoriesService.list) is shown so a retire decision is made
// with the blast radius visible, not blind.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import { markNotificationsReadForEntity } from "../../../lib/notifications";
import { useStaffSession } from "../../../lib/staff-session";
import type { CauseCategory, CauseCategorySuggestion } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconSparkle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";

const WAQF_TYPES: CauseCategory["typicalWaqfTypes"][number][] = ["investment", "asset", "project"];

// Sentinel select value distinct from any real category id, real UUIDs,
// or "" (None/top-level) — picking it swaps the Parent category dropdown
// for two plain inputs so a brand-new parent can be typed in without a
// separate trip to create it standalone first.
const NEW_PARENT_VALUE = "__new__";

// Depth-first flatten of the (now arbitrary-depth — see
// CauseCategory.parentId's schema comment) category tree: each
// top-level category immediately followed by its own descendants,
// recursively, in the same sortOrder/name order the backend already
// returns. A child whose parent got retired/filtered out some other way
// renders as if top-level instead of disappearing. `seen` guards against
// an unexpected cycle in the data turning this into an infinite loop.
function flattenCategoryTree(categories: CauseCategory[]): { category: CauseCategory; depth: number }[] {
  const ids = new Set(categories.map((c) => c.id));
  const byParent = new Map<string, CauseCategory[]>();
  for (const c of categories) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const result: { category: CauseCategory; depth: number }[] = [];
  const seen = new Set<string>();
  function visit(parentKey: string, depth: number) {
    for (const c of byParent.get(parentKey) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      result.push({ category: c, depth });
      visit(c.id, depth + 1);
    }
  }
  visit("__root__", 0);
  return result;
}

export default function CauseCategoriesPage() {
  const { staff } = useStaffSession();
  const isAdmin = staff?.staffRole === "platform_admin";

  const [categories, setCategories] = useState<CauseCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CauseCategory | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Two-click confirm, no modal primitive in @birr/ui yet — first click
  // arms it (button becomes "Confirm retire?"), a second click within the
  // window actually does it. Armed state resets whenever the list reloads.
  const [armedRetireId, setArmedRetireId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetchJson<CauseCategory[]>("/cause-categories?includeRetired=true")
      .then((data) => {
        setCategories(data);
        setArmedRetireId(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRetireClick(category: CauseCategory) {
    if (category.deletedAt) {
      // Restoring is fully reversible and low-stakes — no confirm needed.
      return runToggle(category);
    }
    if (armedRetireId !== category.id) {
      setArmedRetireId(category.id);
      return;
    }
    return runToggle(category);
  }

  async function runToggle(category: CauseCategory) {
    setActionError(null);
    setPendingId(category.id);
    try {
      await apiFetchJson(`/cause-categories/${category.id}/${category.deletedAt ? "restore" : "retire"}`, {
        method: "POST",
      });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconSparkle className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Cause Categories</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            The standard menu Founders pick from for their own Waqf Fund's causes.
          </p>
        </div>
      </header>

      {!isAdmin && staff && (
        <Alert tone="danger" title="platform_admin only to edit" className="mb-6">
          Your role ({humanize(staff.staffRole)}) can view this page but not change it — reach out to a platform
          admin.
        </Alert>
      )}

      <CauseSuggestionsQueue isAdmin={isAdmin} onApproved={load} />

      <section>
        <SectionHeader
          title="Catalog"
          description="Active entries, in display order, are what a Founder sees when picking causes for their fund."
          actionLabel={isAdmin ? (showForm ? "Cancel" : "Add category") : undefined}
          onAction={
            isAdmin
              ? () => {
                  setEditing(null);
                  setShowForm((v) => !v);
                }
              : undefined
          }
        />

        {isAdmin && showForm && (
          <CauseCategoryForm
            key={editing?.id ?? "new"}
            existing={editing}
            categories={categories ?? []}
            onSaved={() => {
              setShowForm(false);
              setEditing(null);
              load();
            }}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        )}

        {(error || actionError) && (
          <Alert tone="danger" title="Something went wrong" className="mb-4">
            {error ?? actionError}
          </Alert>
        )}

        {!error && categories === null && <RowsSkeleton columns={5} />}

        {!error && categories !== null && categories.length === 0 && (
          <EmptyState
            title="No cause categories yet"
            description="Add one above so Founders have something to pick from."
          />
        )}

        {!error && categories !== null && categories.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell>Typical for</TableHeaderCell>
                <TableHeaderCell>Used by</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                {isAdmin && <TableHeaderCell className="text-right">Actions</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {flattenCategoryTree(categories).map(({ category: c, depth }) => (
                <TableRow key={c.id}>
                  <TableCell className="text-slate-500">{c.sortOrder}</TableCell>
                  <TableCell
                    className="font-medium text-slate-900"
                    style={depth > 0 ? { paddingLeft: `${1 + depth * 1.5}rem` } : undefined}
                  >
                    {depth > 0 && <span className="mr-1 text-slate-300">↳</span>}
                    <span className="mr-1.5">{c.icon}</span>
                    {c.name}
                  </TableCell>
                  <TableCell className="max-w-md text-slate-500">{c.description ?? "—"}</TableCell>
                  <TableCell>
                    {c.typicalWaqfTypes.length === 0 ? (
                      <span className="text-slate-500">Any</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.typicalWaqfTypes.map((t) => (
                          <Badge key={t} tone="neutral">
                            {humanize(t)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {c.waqfUsageCount} {c.waqfUsageCount === 1 ? "waqf" : "waqfs"} · {c.vaultUsageCount}{" "}
                    {c.vaultUsageCount === 1 ? "vault" : "vaults"}
                  </TableCell>
                  <TableCell>
                    <Badge tone={c.deletedAt ? "neutral" : "success"}>{c.deletedAt ? "Retired" : "Active"}</Badge>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {!c.deletedAt && (
                          <Button
                            variant="secondary"
                            className="px-3 py-1.5 text-xs"
                            disabled={pendingId === c.id}
                            onClick={() => {
                              setEditing(c);
                              setShowForm(true);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          className={`px-3 py-1.5 text-xs ${
                            armedRetireId === c.id ? "border-red-300 text-red-700" : ""
                          }`}
                          disabled={pendingId === c.id}
                          onClick={() => handleRetireClick(c)}
                        >
                          {pendingId === c.id
                            ? "…"
                            : c.deletedAt
                              ? "Restore"
                              : armedRetireId === c.id
                                ? `Confirm retire${c.usageCount > 0 ? ` (used by ${c.usageCount})` : ""}?`
                                : "Retire"}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function CauseCategoryForm({
  existing,
  categories,
  onSaved,
  onCancel,
}: {
  existing: CauseCategory | null;
  categories: CauseCategory[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? "");
  const [sortOrder, setSortOrder] = useState(existing ? String(existing.sortOrder) : "0");
  const [typicalWaqfTypes, setTypicalWaqfTypes] = useState<CauseCategory["typicalWaqfTypes"]>(
    existing?.typicalWaqfTypes ?? [],
  );
  const [parentId, setParentId] = useState(existing?.parentId ?? "");
  const [newParentName, setNewParentName] = useState("");
  const [newParentDescription, setNewParentDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eligible parents: any active category except this one itself and any
  // of its own descendants (picking a descendant as parent would close a
  // loop — see CauseCategoriesService.validateParent for the
  // authoritative version of this same rule). Options are shown in tree
  // order, indented, so a deep catalog still reads as a hierarchy rather
  // than a flat alphabetical dump.
  const descendantIds = new Set<string>();
  if (existing) {
    const stack = [existing.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const c of categories) {
        if (c.parentId === id && !descendantIds.has(c.id)) {
          descendantIds.add(c.id);
          stack.push(c.id);
        }
      }
    }
  }
  const parentOptions = flattenCategoryTree(categories.filter((c) => !c.deletedAt)).filter(
    ({ category: c }) => c.id !== existing?.id && !descendantIds.has(c.id),
  );

  function toggleType(type: (typeof WAQF_TYPES)[number]) {
    setTypicalWaqfTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    if (parentId === NEW_PARENT_VALUE) {
      if (!newParentName.trim()) {
        setError("New parent category name is required.");
        return;
      }
      if (!newParentDescription.trim()) {
        setError("New parent category description is required.");
        return;
      }
    }
    setSubmitting(true);
    try {
      // Two plain requests, not one atomic operation — this is catalog
      // metadata (see CauseCategoriesService's own "not governed_actions"
      // comment), so if the second request fails the first still leaves
      // a real, usable top-level category behind rather than a dangling
      // half-write; it just won't have this child under it yet.
      let resolvedParentId: string | null = parentId === NEW_PARENT_VALUE ? null : parentId || null;
      if (parentId === NEW_PARENT_VALUE) {
        const newParent = await apiFetchJson<CauseCategory>("/cause-categories", {
          method: "POST",
          body: JSON.stringify({ name: newParentName.trim(), description: newParentDescription.trim() }),
        });
        resolvedParentId = newParent.id;
      }
      const body = JSON.stringify({
        name: name.trim(),
        description: description.trim(),
        icon: icon.trim() || undefined,
        sortOrder: Number(sortOrder) || 0,
        typicalWaqfTypes,
        // null (not undefined) when cleared, so an edit can actually
        // remove an existing parent — omitting the field would leave it
        // untouched instead. See UpdateCauseCategoryInput.parentId.
        parentId: resolvedParentId,
      });
      if (existing) {
        await apiFetchJson(`/cause-categories/${existing.id}`, { method: "PUT", body });
      } else {
        await apiFetchJson("/cause-categories", { method: "POST", body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title={existing ? "Couldn't save category" : "Couldn't add category"}>
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-20 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Icon</label>
          <Input placeholder="🎓" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="min-w-[16rem] flex-[2] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description</label>
          <Input required value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </div>
        <div className="w-24 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Order</label>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            title="Lower numbers show first in a Founder's picker."
          />
        </div>
        <div className="min-w-[10rem] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Parent category (optional)</label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">None (top-level)</option>
            {parentOptions.map(({ category: p, depth }) => (
              <option key={p.id} value={p.id}>
                {"—".repeat(depth) + (depth > 0 ? " " : "")}
                {p.name}
              </option>
            ))}
            <option value={NEW_PARENT_VALUE}>+ Create new parent…</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : existing ? "Save" : "Add"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      {parentId === NEW_PARENT_VALUE && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-accent-200 bg-accent-50 p-3">
          <div className="min-w-[10rem] flex-1 space-y-1.5">
            <label className="text-sm font-medium text-slate-700">New parent category name</label>
            <Input
              required
              autoFocus
              value={newParentName}
              onChange={(e) => setNewParentName(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="min-w-[16rem] flex-[2] space-y-1.5">
            <label className="text-sm font-medium text-slate-700">New parent category description</label>
            <Input
              required
              value={newParentDescription}
              onChange={(e) => setNewParentDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <p className="basis-full text-xs text-slate-500">
            Created as its own top-level catalog entry when you save — you can add an icon or display order to it
            afterward from the table below.
          </p>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Typical for <span className="font-normal text-slate-500">(optional — a UX hint only, never restricts who can pick this)</span>
        </label>
        <div className="flex flex-wrap gap-3">
          {WAQF_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={typicalWaqfTypes.includes(type)}
                onChange={() => toggleType(type)}
                className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
              />
              {humanize(type)}
            </label>
          ))}
        </div>
      </div>
    </form>
  );
}

/**
 * A Founder's requests to add something new to the standard catalog
 * (see app/(founder)/portfolio/[id]/CausesSection.tsx's SuggestCauseForm)
 * — only rendered at all once there's at least one, to avoid permanent
 * clutter on a page most visits will find empty. Approve/reject are
 * platform_admin-only, same authority level as the catalog table below.
 */
function CauseSuggestionsQueue({ isAdmin, onApproved }: { isAdmin: boolean; onApproved: () => void }) {
  const [suggestions, setSuggestions] = useState<CauseCategorySuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetchJson<CauseCategorySuggestion[]>("/cause-category-suggestions")
      .then(setSuggestions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pending = suggestions?.filter((s) => s.status === "pending") ?? [];

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — this queue IS the content
  // cause_suggestion.pending's linkUrl points to.
  useEffect(() => {
    pending.forEach((s) => markNotificationsReadForEntity("CauseCategorySuggestion", s.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  if (!error && suggestions !== null && pending.length === 0) return null;

  return (
    <section className="mb-10">
      <SectionHeader title="Cause Suggestions" description="Requests from Founders to add something new to the standard catalog." />

      {error && (
        <Alert tone="danger" title="Couldn't load suggestions" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && suggestions === null && <RowsSkeleton columns={3} />}

      {!error && pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              isAdmin={isAdmin}
              deciding={decidingId === s.id}
              onDecidingChange={(deciding) => setDecidingId(deciding ? s.id : null)}
              onDecided={() => {
                load();
                onApproved();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SuggestionRow({
  suggestion,
  isAdmin,
  deciding,
  onDecidingChange,
  onDecided,
}: {
  suggestion: CauseCategorySuggestion;
  isAdmin: boolean;
  deciding: boolean;
  onDecidingChange: (deciding: boolean) => void;
  onDecided: () => void;
}) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [description, setDescription] = useState(suggestion.description ?? "");
  const [icon, setIcon] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [typicalWaqfTypes, setTypicalWaqfTypes] = useState<CauseCategory["typicalWaqfTypes"]>([]);
  const [reviewNotes, setReviewNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleType(type: (typeof WAQF_TYPES)[number]) {
    setTypicalWaqfTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  function startMode(next: "approve" | "reject") {
    setMode(next);
    setError(null);
    onDecidingChange(true);
  }

  function cancel() {
    setMode(null);
    onDecidingChange(false);
  }

  async function submitApprove(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson(`/cause-category-suggestions/${suggestion.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          description: description.trim(),
          icon: icon.trim() || undefined,
          sortOrder: Number(sortOrder) || 0,
          typicalWaqfTypes,
        }),
      });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  async function submitReject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reviewNotes.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson(`/cause-category-suggestions/${suggestion.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewNotes: reviewNotes.trim() }),
      });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">{suggestion.name}</p>
          {suggestion.description && <p className="text-sm text-slate-600">{suggestion.description}</p>}
          <p className="mt-1 text-xs text-slate-500">
            Proposed by {suggestion.proposedByUser.fullName} ({suggestion.proposedByFounder.name})
            {suggestion.waqf && <> for {suggestion.waqf.name}</>} · {formatDate(suggestion.createdAt)}
          </p>
        </div>
        {isAdmin && !deciding && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => startMode("approve")}>
              Approve
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => startMode("reject")}>
              Reject
            </Button>
          </div>
        )}
      </div>

      {mode === "approve" && (
        <form onSubmit={submitApprove} className="mt-3 space-y-3 border-t border-accent-200 pt-3">
          {error && (
            <Alert tone="danger" title="Couldn't approve">
              {error}
            </Alert>
          )}
          <p className="text-xs text-slate-500">
            Set the catalog details this suggestion didn't include — same fields as adding a category directly.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <Input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="What this cause covers, so a Founder knows what they're picking."
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-20 space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Icon</label>
              <Input placeholder="🎓" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} />
            </div>
            <div className="w-24 space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Order</label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Approving…" : "Confirm approve"}
              </Button>
              <Button type="button" variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {WAQF_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={typicalWaqfTypes.includes(type)}
                  onChange={() => toggleType(type)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
                />
                {humanize(type)}
              </label>
            ))}
          </div>
        </form>
      )}

      {mode === "reject" && (
        <form onSubmit={submitReject} className="mt-3 space-y-3 border-t border-accent-200 pt-3">
          {error && (
            <Alert tone="danger" title="Couldn't reject">
              {error}
            </Alert>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Reason (shown only internally)</label>
            <Input required value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} maxLength={500} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Rejecting…" : "Confirm reject"}
            </Button>
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
