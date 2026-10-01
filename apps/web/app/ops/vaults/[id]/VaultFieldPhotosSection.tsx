"use client";

// Photos taken in the field when this vault's money is actually delivered or
// a project step is executed — the pictures behind the homepage's "Our impact"
// wall. Each upload documents ONE real delivery (a distribution) or milestone
// of THIS vault, and there is no publishing step: a photo appears on the
// public site by itself once that delivery is paid or that milestone is
// completed. What guards the people in the pictures instead:
//  - the uploader confirms consent (a child's guardian, for a child);
//  - the stored file has its location and camera data stripped server-side;
//  - anyone here can hide a photo instantly (Legal and Compliance included) —
//    taking one down never needs a second person.
// Many photos can be chosen and uploaded in one go.
import { useRef, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import type { VaultDistribution, VaultFieldPhoto, VaultMilestone } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Select } from "@birr/ui";
import { SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

type Causes = { id: string; name: string }[];

export function VaultFieldPhotosSection({
  vaultId,
  causes,
  milestones,
}: {
  vaultId: string;
  causes: Causes;
  milestones: VaultMilestone[];
}) {
  const [showForm, setShowForm] = useState(false);
  const { data: photos, error, reload } = useLoadedResource(
    () => apiFetchJson<VaultFieldPhoto[]>(`/impact/photos/staff?vaultId=${vaultId}`),
    [vaultId],
  );
  const { data: distributions } = useLoadedResource(
    () => apiFetchJson<VaultDistribution[]>(`/vault-distributions?vaultId=${vaultId}`),
    [vaultId],
  );

  return (
    <section>
      <SectionHeader
        title="Field photos"
        description="Photos from deliveries and project steps. They show on the homepage automatically once the delivery is paid or the milestone completed."
        actionLabel={showForm ? "Cancel" : "Upload photos"}
        onAction={() => setShowForm((v) => !v)}
      />

      {showForm && (
        <UploadForm
          vaultId={vaultId}
          causes={causes}
          distributions={distributions ?? []}
          milestones={milestones}
          onUploaded={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load photos" className="mb-4">
          {error}
        </Alert>
      )}
      {!error && photos !== null && photos.length === 0 && !showForm && (
        <EmptyState title="No field photos yet" description="Upload photos taken when a delivery was made or a milestone completed." />
      )}

      {photos && photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {photos.map((photo) => (
            <PhotoCard key={photo.id} photo={photo} onChanged={reload} />
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoCard({ photo, onChanged }: { photo: VaultFieldPhoto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "hide" | "unhide" | "archive") {
    setBusy(true);
    setError(null);
    try {
      await apiFetchJson(`/impact/photos/${photo.id}/${action}`, { method: "POST" });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.imageUrl} alt={photo.caption ?? photo.title} className={`h-32 w-full object-cover ${photo.hidden ? "opacity-40 grayscale" : ""}`} />
      <div className="space-y-1.5 p-2.5">
        <p className="truncate text-xs font-medium text-slate-800">{photo.title}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {photo.showing ? (
            <Badge tone="success">On homepage</Badge>
          ) : photo.hidden ? (
            <Badge tone="danger">Hidden</Badge>
          ) : (
            <Badge tone="warning">Waiting</Badge>
          )}
          <span className="text-[11px] text-slate-500">{humanize(photo.kind)}</span>
        </div>
        {photo.waitingFor && <p className="text-[11px] text-slate-500">Shows once {photo.waitingFor}.</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="flex gap-1.5 pt-0.5">
          <Button variant="secondary" className="px-2 py-1 text-[11px]" disabled={busy} onClick={() => run(photo.hidden ? "unhide" : "hide")}>
            {photo.hidden ? "Show again" : "Hide"}
          </Button>
          <Button variant="secondary" className="px-2 py-1 text-[11px]" disabled={busy} onClick={() => run("archive")}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

function UploadForm({
  vaultId,
  causes,
  distributions,
  milestones,
  onUploaded,
}: {
  vaultId: string;
  causes: Causes;
  distributions: VaultDistribution[];
  milestones: VaultMilestone[];
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [event, setEvent] = useState(""); // "distribution:<id>" | "milestone:<id>"
  const [caption, setCaption] = useState("");
  const [consent, setConsent] = useState(false);
  const [count, setCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const causeName = (id: string) => causes.find((c) => c.id === id)?.name ?? "a cause";
  // Only deliveries and milestones that can actually be documented: a rejected
  // or failed payout was never delivered.
  const deliverable = distributions.filter((d) => d.status !== "rejected" && d.status !== "payout_failed");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const files = Array.from(fileRef.current?.files ?? []);
    if (!event) return setError("Choose the delivery or milestone these photos document.");
    if (files.length === 0) return setError("Choose at least one photo.");
    const [eventType, eventId] = event.split(":");
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      files.forEach((f) => body.append("photos", f));
      body.append("vaultId", vaultId);
      body.append("eventType", eventType);
      body.append("eventId", eventId);
      if (caption.trim()) body.append("caption", caption);
      body.append("consentConfirmed", String(consent));
      await apiFetchJson("/impact/photos", { method: "POST", body });
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-5 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't upload">
          {error}
        </Alert>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">What do these photos document?</label>
        <Select value={event} onChange={(e) => setEvent(e.target.value)}>
          <option value="">Choose a delivery or milestone…</option>
          {deliverable.length > 0 && (
            <optgroup label="Deliveries">
              {deliverable.map((d) => (
                <option key={d.id} value={`distribution:${d.id}`}>
                  {d.currency} {Number(d.amount).toLocaleString("en-NG")} to {causeName(d.vaultCauseId)} — {humanize(d.status)}
                </option>
              ))}
            </optgroup>
          )}
          {milestones.length > 0 && (
            <optgroup label="Milestones">
              {milestones.map((m) => (
                <option key={m.id} value={`milestone:${m.id}`}>
                  {m.sequence}. {m.name} — {humanize(m.status)}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        <p className="text-xs text-slate-500">Photos stay private until that delivery is paid or that milestone is completed.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Photos (PNG, JPEG or WebP, up to 8MB each, 20 at a time)</label>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setCount(e.target.files?.length ?? 0)}
          className="block w-full text-sm text-slate-700"
        />
        <p className="text-xs text-slate-500">
          {count > 0 ? `${count} selected. ` : ""}Location and camera details are removed automatically, and each picture is resized for the web.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Note (optional — what's happening in them)</label>
        <Input maxLength={300} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Handover to the Kaduna community committee" />
      </div>

      <label className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>
          I confirm Birr has the right to publish these photos, and that everyone identifiable in them has consented —
          or their parent or guardian, for a child.
        </span>
      </label>

      <Button type="submit" disabled={submitting || !consent}>
        {submitting ? "Uploading…" : "Upload photos"}
      </Button>
    </form>
  );
}
