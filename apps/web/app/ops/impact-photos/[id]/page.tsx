"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ImpactPhoto } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Input, Skeleton } from "@birr/ui";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";
import { ARTICLE_STATUS_TONE } from "../../articles/status";

export default function ImpactPhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { staff } = useStaffSession();
  const [photo, setPhoto] = useState<ImpactPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"unpublish" | "archive" | null>(null);
  const [busy, setBusy] = useState(false);
  const [altText, setAltText] = useState("");
  const [credit, setCredit] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<ImpactPhoto>(`/impact/photos/${id}`)
      .then((p) => {
        setPhoto(p);
        setAltText(p.altText);
        setCredit(p.credit ?? "");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError(null);
    setSaved(false);
    try {
      setPhoto(await apiFetchJson<ImpactPhoto>(`/impact/photos/${id}`, { method: "PATCH", body: JSON.stringify({ altText, credit }) }));
      setSaved(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: "unpublish" | "archive") {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetchJson(`/impact/photos/${id}/${action}`, { method: "POST" });
      setConfirming(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this photo">
        {error}
      </Alert>
    );
  }
  if (!photo) return <Skeleton className="h-64 w-full max-w-xl" />;

  const canPropose = staff?.staffRole === "mutawalli_officer";

  return (
    <div>
      <header className="mb-6">
        <Link href="/ops/impact-photos" className="text-sm text-slate-500 hover:text-primary-700">
          ← Impact photos
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Impact photo</h1>
            <Badge tone={ARTICLE_STATUS_TONE[photo.status]}>{humanize(photo.status)}</Badge>
            {photo.reviewedByName && <span className="text-sm text-slate-500">Reviewed by {photo.reviewedByName}</span>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {photo.status === "draft" && canPropose && (
                <ProposeGovernedActionButton permissionKey="impact_photo.publish" payload={{ photoId: photo.id }} label="Propose publish" onProposed={load} />
              )}
              {photo.status === "published" && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setConfirming("unpublish")}>
                  Unpublish
                </Button>
              )}
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setConfirming("archive")}>
                Archive
              </Button>
            </div>
            {photo.status === "draft" && !canPropose && (
              <p className="max-w-xs text-right text-xs text-slate-500">Only a Mutawalli Officer proposes publication; Legal or Compliance then approves it.</p>
            )}
          </div>
        </div>
      </header>

      {actionError && (
        <Alert tone="danger" title="That didn't work" className="mb-4">
          {actionError}
        </Alert>
      )}
      {confirming && (
        <Alert tone="warning" title={confirming === "unpublish" ? "Take this photo off the public site?" : "Archive this photo?"} className="mb-6">
          <p className="mb-3">
            {confirming === "unpublish"
              ? "It goes back to draft and disappears from the homepage. Publishing it again needs a fresh review."
              : "It's removed from this list and the public site. Archived photos are kept for the audit trail, not deleted."}
          </p>
          <div className="flex gap-2">
            <Button className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => run(confirming)}>
              {busy ? "…" : confirming === "unpublish" ? "Yes, unpublish" : "Yes, archive"}
            </Button>
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.imageUrl} alt={photo.altText} className="w-full rounded-xl border border-slate-200 object-contain" />

        {photo.status === "draft" ? (
          <form onSubmit={save} className="space-y-4">
            {saved && <Alert tone="success" title="Saved">Draft updated.</Alert>}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Description</label>
              <Input required minLength={5} maxLength={300} value={altText} onChange={(e) => setAltText(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Credit (optional)</label>
              <Input maxLength={120} value={credit} onChange={(e) => setCredit(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save draft"}
            </Button>
            <p className="text-xs text-slate-500">
              Before proposing, look at the picture itself: does it show anything that shouldn't be public — a house number, a school name on a uniform, a face without consent?
            </p>
          </form>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            <Alert tone="info" title="Read-only">Approved photos are frozen. Unpublish to change the description.</Alert>
            <p><span className="font-medium">Description:</span> {photo.altText}</p>
            {photo.credit && <p><span className="font-medium">Credit:</span> {photo.credit}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
