"use client";

// Photos for the public homepage's "Our impact" frames. Anyone in an
// authoring role can upload a draft; taking one live is a governed
// impact_photo.publish action — proposed by a Mutawalli Officer, approved
// by Legal or Compliance on the Approvals page — because these are
// pictures of real people on a public marketing page.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import type { ImpactPhoto } from "../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, IconFileText, Input } from "@birr/ui";
import { RowsSkeleton } from "../_components/SectionChrome";
import { ARTICLE_STATUS_TONE } from "../articles/status";

export default function ImpactPhotosPage() {
  const [photos, setPhotos] = useState<ImpactPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<ImpactPhoto[]>("/impact/photos/staff")
      .then(setPhotos)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconFileText className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Impact photos</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
              Pictures shown in the frames of the homepage's "Our impact" section. Uploads are private drafts;
              publishing needs a second person — Legal or Compliance — to approve it on the Approvals page. The
              four newest approved photos are shown.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Upload photo"}</Button>
      </header>

      {showForm && (
        <UploadForm
          onUploaded={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load photos" className="mb-4">
          {error}
        </Alert>
      )}
      {!error && photos === null && <RowsSkeleton columns={3} />}
      {!error && photos !== null && photos.length === 0 && !showForm && (
        <EmptyState title="No photos yet" description="Upload the first one — it starts as a private draft." />
      )}

      {!error && photos !== null && photos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => (
            <Link key={p.id} href={`/ops/impact-photos/${p.id}`} className="group overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imageUrl} alt={p.altText} className="h-44 w-full object-cover" />
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <Badge tone={ARTICLE_STATUS_TONE[p.status]}>{humanize(p.status)}</Badge>
                  {p.reviewedByName && <span className="text-xs text-slate-500">Reviewed by {p.reviewedByName}</span>}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-700 group-hover:text-primary-700">{p.altText}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [altText, setAltText] = useState("");
  const [credit, setCredit] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a photo to upload.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("photo", file);
      body.append("altText", altText);
      if (credit.trim()) body.append("credit", credit);
      body.append("consentConfirmed", String(consent));
      await apiFetchJson("/impact/photos", { method: "POST", body });
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't upload">
          {error}
        </Alert>
      )}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Photo (PNG, JPEG or WebP, up to 8MB)</label>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm text-slate-700" />
        <p className="text-xs text-slate-500">
          Location and camera details are removed automatically, and the picture is resized for the web.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Description (for screen readers — say what's in the picture)</label>
        <Input required minLength={5} maxLength={300} value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Children collecting water at a new borehole in Kano" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Credit (optional)</label>
        <Input maxLength={120} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Photo: Birr field team" />
      </div>
      <label className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>
          I confirm Birr has the right to publish this photo, and that everyone identifiable in it has consented — or
          their parent or guardian, for a child.
        </span>
      </label>
      <Button type="submit" disabled={submitting || !consent}>
        {submitting ? "Uploading…" : "Upload as draft"}
      </Button>
    </form>
  );
}
