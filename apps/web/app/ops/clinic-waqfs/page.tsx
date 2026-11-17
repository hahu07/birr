"use client";

// Clinic waqfs (2026-11-17): the Mother & Child Clinic product. A waqf Birr
// itself establishes, which Founders and the public give into (from a later
// slice). A Mutawalli Officer creates one as a draft and drafts its deed; a
// Shariah board member approves the deed and the Board of Trustees
// approves establishing it, both on the Approvals page.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { ClinicWaqf } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  IconHeart,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { CountrySelect } from "../../../components/forms/CountrySelect";
import { countryName, FIELD_LIMITS } from "@birr/shared";

export default function ClinicWaqfsPage() {
  const [clinics, setClinics] = useState<ClinicWaqf[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { can } = useStaffSession();
  const canCreate = can("clinic_waqf.manage");

  const load = useCallback(() => {
    apiFetchJson<ClinicWaqf[]>("/clinic-waqfs")
      .then(setClinics)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconHeart className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Clinic Waqfs</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Laboratories and clinics for women and young children, each held in a waqf Birr establishes. Founders and
            the public give into it; a licensed operator runs it.
          </p>
        </div>
      </header>

      <section>
        <SectionHeader
          title="Clinic waqfs"
          description="Starts as a draft. Draft its deed for Shariah approval, then propose establishing it to the Board."
          actionLabel={canCreate ? (showForm ? "Cancel" : "Create clinic waqf") : undefined}
          onAction={canCreate ? () => setShowForm((v) => !v) : undefined}
        />

        {canCreate && showForm && (
          <CreateForm
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        )}

        {error && (
          <Alert tone="danger" title="Couldn't load clinic waqfs" className="mb-4">
            {error}
          </Alert>
        )}

        {!error && clinics === null && <RowsSkeleton columns={5} />}

        {!error && clinics !== null && clinics.length === 0 && !showForm && (
          <EmptyState title="No clinic waqfs yet" description="Create one to start drafting its deed." />
        )}

        {!error && clinics !== null && clinics.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>City</TableHeaderCell>
                <TableHeaderCell>Jurisdiction</TableHeaderCell>
                <TableHeaderCell>Deed</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {clinics.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-slate-900">
                    <Link href={`/ops/clinic-waqfs/${c.id}`} className="hover:text-primary-700">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>{c.city}</TableCell>
                  <TableCell className="text-slate-500">{countryName(c.jurisdiction)}</TableCell>
                  <TableCell className="text-slate-500">{c.deeds[0] ? `Version ${c.deeds[0].version} approved` : "Not approved yet"}</TableCell>
                  <TableCell>
                    <Badge tone={c.status === "established" ? "success" : "neutral"}>{humanize(c.status)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [city, setCity] = useState("Ibadan");
  const [jurisdiction, setJurisdiction] = useState("NG");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetchJson("/clinic-waqfs", {
        method: "POST",
        body: JSON.stringify({ name, slug, city, jurisdiction, description: description || undefined }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <Alert tone="danger" title="Couldn't create the clinic waqf">
            {error}
          </Alert>
        )}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[14rem] flex-1 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Name</label>
            <Input required check="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mother & Child Clinic, Ibadan" />
          </div>
          <div className="min-w-[14rem] flex-1 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Web address</label>
            <Input
              required
              value={slug}
              maxLength={100}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase letters, numbers and single hyphens"
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="mother-and-child-clinic-ibadan"
            />
            <p className="text-xs text-slate-500">Fixed once set, so shared links never break.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[10rem] flex-1 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">City</label>
            <Input required check="name" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="w-52 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Jurisdiction</label>
            <CountrySelect value={jurisdiction} onChange={setJurisdiction} />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Description (optional)</label>
          <textarea
            rows={3}
            maxLength={FIELD_LIMITS.longText}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            Create draft
          </Button>
        </div>
      </form>
    </Card>
  );
}
