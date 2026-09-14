"use client";

// Vault detail — the working view for one staff-curated public-giving
// campaign: its causes, and (investment-style only) its investments and
// proceeds, plus distributions to relief/delivery partners. Registration
// is plain CRUD throughout; allocation, investment changes, and
// distribution approval are always governed_actions, proposed here and
// decided on the Approval Queue page, never here — same posture as the
// Waqf Fund detail page this mirrors.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import type { Vault, VaultMilestone, VaultStatus } from "../../../../lib/ops-types";
import { Alert, Badge, Button, IconArchive, Skeleton } from "@birr/ui";
import { VaultCausesSection } from "./VaultCausesSection";
import { VaultInvestmentsSection } from "./VaultInvestmentsSection";
import { VaultProceedsSection } from "./VaultProceedsSection";
import { VaultDistributionsSection } from "./VaultDistributionsSection";
import { VaultContributionsSection } from "./VaultContributionsSection";
import { VaultMilestonesSection } from "./VaultMilestonesSection";
import { VaultExpensesSection } from "./VaultExpensesSection";
import { VaultLedgerSection } from "./VaultLedgerSection";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";
import { useLoadedResource } from "../../_components/SectionChrome";

const STATUS_TONE: Record<VaultStatus, "success" | "warning" | "neutral" | "danger"> = {
  draft: "neutral",
  open: "success",
  closed: "warning",
  archived: "danger",
};

// Mirrors ALLOWED_STATUS_TRANSITIONS in vaults.service.ts — the server
// re-validates for real, this only decides which buttons to show.
// draft -> open is deliberately absent here: unlike every other
// transition, publishing a vault for the first time is the governed
// "vault.publish" action (see StatusActions' own dedicated branch
// below), not a direct PATCH one staff member can trigger alone.
const NEXT_STATUSES: Record<VaultStatus, VaultStatus[]> = {
  draft: [],
  open: ["closed"],
  closed: ["open", "archived"],
  archived: [],
};

export default function VaultDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [vault, setVault] = useState<Vault | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by VaultCausesSection whenever a cause is added or an
  // allocation proposal is decided-in-place refreshed — Distributions
  // needs the fresh cause list to pick from.
  const [causesVersion, setCausesVersion] = useState(0);

  const load = useCallback(() => {
    apiFetchJson<Vault>(`/vaults/${id}`)
      .then(setVault)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Project vaults only (VaultMilestonesService itself rejects
  // creation against anything else) — fetched at this level, not
  // inside VaultMilestonesSection alone, since VaultExpensesSection's
  // own milestone-link dropdown needs the same list. Hooks run
  // unconditionally before the early error/loading returns below, so
  // `vault` may still be null on the first render — the fetcher itself
  // guards against that rather than skipping the hook call.
  const { data: milestones, reload: reloadMilestones } = useLoadedResource(
    () => (vault?.type === "project" ? apiFetchJson<VaultMilestone[]>(`/vault-milestones?vaultId=${id}`) : Promise.resolve([])),
    [id, vault?.type],
  );

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this vault">
        {error}
      </Alert>
    );
  }

  if (!vault) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  const causes = vault.causes ?? [];

  return (
    <div>
      <header className="mb-8">
        <Link href="/ops/vaults" className="text-sm text-slate-500 hover:text-primary-700">
          ← Vaults
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <CoverImageControl vault={vault} onChanged={load} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{vault.name}</h1>
                <Badge tone={STATUS_TONE[vault.status]}>{humanize(vault.status)}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {humanize(vault.type)} · {vault.currency} · {vault.jurisdiction} · /vaults/{vault.slug}
              </p>
              {vault.description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{vault.description}</p>}
            </div>
          </div>
          <StatusActions vault={vault} onChanged={load} />
        </div>
      </header>

      <div className="space-y-10">
        <VaultCausesSection
          vaultId={id}
          vaultType={vault.type}
          currency={vault.currency}
          onChanged={() => {
            load();
            setCausesVersion((v) => v + 1);
          }}
        />
        {vault.type === "investment" && (
          <>
            <VaultInvestmentsSection vaultId={id} currency={vault.currency} />
            <VaultProceedsSection vaultId={id} currency={vault.currency} />
          </>
        )}
        {vault.type === "project" && (
          <>
            <VaultMilestonesSection
              vaultId={id}
              currency={vault.currency}
              onChanged={reloadMilestones}
            />
            <VaultExpensesSection
              vaultId={id}
              currency={vault.currency}
              additionalCurrencies={vault.additionalCurrencies}
              milestones={milestones ?? []}
            />
          </>
        )}
        <VaultDistributionsSection vaultId={id} currency={vault.currency} causes={causes} milestones={milestones ?? []} />
        <VaultContributionsSection vaultId={id} currency={vault.currency} />
        <VaultLedgerSection vaultId={id} currency={vault.currency} additionalCurrencies={vault.additionalCurrencies} />
      </div>
    </div>
  );
}

// The cover shown on the public homepage's "Support a cause" cards
// (app/(founder)/MarketingHome.tsx) — a plain PNG/JPEG/WebP upload
// (multipart, POST /vaults/:id/cover), same convention as a Foundation
// logo. Falls back to the archive icon badge until one's set; hovering
// the badge/thumbnail is what reveals the (re)upload control, so it
// doesn't compete with the vault's name/status for attention on a page
// that's mostly about causes and money, not branding.
function CoverImageControl({ vault, onChanged }: { vault: Vault; onChanged: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("cover", file);
      await apiFetchJson(`/vaults/${vault.id}/cover`, { method: "POST", body: formData });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title={vault.coverImageUrl ? "Change cover image" : "Upload a cover image"}
        className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25"
      >
        {vault.coverImageUrl ? (
          <img src={vault.coverImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <IconArchive className="h-5 w-5" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100">
          {uploading ? "…" : vault.coverImageUrl ? "Change" : "Upload"}
        </span>
      </button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileSelected} />
      {error && <p className="mt-1 max-w-[10rem] text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

function StatusActions({ vault, onChanged }: { vault: Vault; onChanged: () => void }) {
  const [submitting, setSubmitting] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT_STATUSES[vault.status];

  // Publishing a draft is the one status change that's governed — see
  // NEXT_STATUSES' own comment. The real effect only happens once a
  // different, eligible staff member approves it on the Approval Queue,
  // which already renders any payload generically and needed no changes
  // to pick this permission up.
  if (vault.status === "draft") {
    return (
      <div className="shrink-0 text-right">
        <ProposeGovernedActionButton
          permissionKey="vault.publish"
          payload={{ vaultId: vault.id }}
          label="Propose publish"
          onProposed={onChanged}
        />
      </div>
    );
  }

  if (next.length === 0) return null;

  async function moveTo(status: VaultStatus) {
    setError(null);
    setSubmitting(status);
    try {
      await apiFetchJson(`/vaults/${vault.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="shrink-0 text-right">
      <div className="flex gap-2">
        {next.map((status) => (
          <Button
            key={status}
            variant={status === "open" ? "primary" : "secondary"}
            disabled={submitting !== null}
            onClick={() => moveTo(status)}
          >
            {submitting === status ? "…" : status === "open" ? "Publish" : `Move to ${humanize(status)}`}
          </Button>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
