"use client";

// A feasibility study, business case, or needs assessment a donor can
// read before giving (2026-09-14) — public the moment it's set, unlike
// VaultMilestone's own evidence fields (see Vault.feasibilityReportUrl's
// own schema comment on why this one's meant for a donor's own due
// diligence, not staff-internal proof of work already done). Notes and
// file save independently: picking a file uploads it immediately, same
// convention as VaultMilestonesSection's own EvidencePanel — a staff
// member expects "I chose a file" to mean "it's attached," not
// "attached once I also remember to click a separate Save."
import { useRef, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import type { Vault } from "../../../../lib/ops-types";
import { Alert, Button, Input } from "@birr/ui";
import { SectionHeader } from "../../_components/SectionChrome";

export function VaultFeasibilityReportSection({ vault, onChanged }: { vault: Vault; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(vault.feasibilityReportTitle ?? "");
  const [savingTitle, setSavingTitle] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveTitle() {
    setSavingTitle(true);
    setError(null);
    try {
      await apiFetchJson(`/vaults/${vault.id}/feasibility-report`, { method: "POST", body: JSON.stringify({ title }) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("report", file);
      await apiFetchJson(`/vaults/${vault.id}/feasibility-report`, { method: "POST", body: formData });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploadingFile(false);
    }
  }

  return (
    <section>
      <SectionHeader
        title="Feasibility report"
        description="A study, business case, or needs assessment — shown publicly on this vault's donation page so a donor can do their own due diligence before giving."
      />

      {error && (
        <Alert tone="danger" title="Couldn't save">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kaduna Water Needs Assessment, 2026" />
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={savingTitle} onClick={handleSaveTitle}>
            {savingTitle ? "Saving…" : "Save title"}
          </Button>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700">File</p>
          {vault.feasibilityReportUrl && (
            <a
              href={vault.feasibilityReportUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-sm text-primary-700 hover:underline"
            >
              View current report →
            </a>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={uploadingFile}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadingFile ? "Uploading…" : vault.feasibilityReportUrl ? "Replace file" : "Upload file"}
          </Button>
          <p className="text-xs text-slate-400">PNG, JPEG, WebP, or PDF — 10MB max.</p>
        </div>
      </div>
    </section>
  );
}
