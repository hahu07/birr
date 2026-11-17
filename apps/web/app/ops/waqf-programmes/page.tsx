"use client";

// Waqf programmes (2026-11-17, shared layer step 4): waqfs Birr itself
// establishes and curates, of any product in WAQF_PROGRAMME_PRODUCTS (the
// clinic waqf first), filtered by product, cause and status. A Mutawalli
// Officer creates one as a draft and drafts its deed; a Shariah board
// member approves the deed and the Board of Trustees approves establishing
// it, both on the Approvals page.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { WaqfProgramme } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  IconHeart,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { CountrySelect } from "../../../components/forms/CountrySelect";
import { countryName, FIELD_LIMITS, WAQF_PROGRAMME_PRODUCTS, type WaqfProgrammeProductKey } from "@birr/shared";

const PRODUCT_KEYS = Object.keys(WAQF_PROGRAMME_PRODUCTS) as WaqfProgrammeProductKey[];

export default function WaqfProgrammesPage() {
  const [clinics, setClinics] = useState<WaqfProgramme[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [product, setProduct] = useState("");
  const [cause, setCause] = useState("");
  const [status, setStatus] = useState("");
  // Causes any programme serves, for the cause filter (kept across filtering).
  const [causeOptions, setCauseOptions] = useState<{ id: string; name: string }[]>([]);
  const { can } = useStaffSession();
  const canCreate = can("waqf_programme.manage");

  const load = useCallback(() => {
    const query = new URLSearchParams({ ...(product && { product }), ...(cause && { causeCategoryId: cause }), ...(status && { status }) }).toString();
    apiFetchJson<WaqfProgramme[]>(`/waqf-programmes${query ? `?${query}` : ""}`)
      .then((list) => {
        setClinics(list);
        setCauseOptions((known) => {
          const all = new Map(known.map((c) => [c.id, c]));
          for (const p of list) for (const c of p.causes ?? []) all.set(c.causeCategory.id, c.causeCategory);
          return [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [product, cause, status]);

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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Waqf Programmes</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Waqfs Birr establishes and curates, such as clinics for women and young children. Founders and the public give
            into them; Birr is trustee.
          </p>
        </div>
      </header>

      <section>
        <SectionHeader
          title="Programmes"
          description="Each starts as a draft. Draft its deed for Shariah approval, then propose establishing it to the Board."
          actionLabel={canCreate ? (showForm ? "Cancel" : "Create waqf programme") : undefined}
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

        <div className="mb-4 flex flex-wrap gap-3" role="group" aria-label="Filter programmes">
          <Select aria-label="Product" value={product} onChange={(e) => setProduct(e.target.value)} className="w-44">
            <option value="">All products</option>
            {PRODUCT_KEYS.map((k) => (
              <option key={k} value={k}>
                {WAQF_PROGRAMME_PRODUCTS[k].plural}
              </option>
            ))}
          </Select>
          <Select aria-label="Cause" value={cause} onChange={(e) => setCause(e.target.value)} className="w-52">
            <option value="">All causes</option>
            {causeOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="established">Established</option>
          </Select>
        </div>

        {error && (
          <Alert tone="danger" title="Couldn't load the programmes" className="mb-4">
            {error}
          </Alert>
        )}

        {!error && clinics === null && <RowsSkeleton columns={7} />}

        {!error && clinics !== null && clinics.length === 0 && !showForm && (
          <EmptyState
            title={product || cause || status ? "No programmes match" : "No waqf programmes yet"}
            description={product || cause || status ? "Try other filters." : "Create one to start drafting its deed."}
          />
        )}

        {!error && clinics !== null && clinics.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Product</TableHeaderCell>
                <TableHeaderCell>Serves</TableHeaderCell>
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
                    <Link href={`/ops/waqf-programmes/${c.id}`} className="hover:text-primary-700">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>{WAQF_PROGRAMME_PRODUCTS[c.product].label}</TableCell>
                  <TableCell className="text-slate-500">{(c.causes ?? []).map((x) => x.causeCategory.name).join(", ") || "—"}</TableCell>
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
  const [product, setProduct] = useState<WaqfProgrammeProductKey>("clinic");
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
      await apiFetchJson("/waqf-programmes", {
        method: "POST",
        body: JSON.stringify({ product, name, slug, city, jurisdiction, description: description || undefined }),
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
          <Alert tone="danger" title="Couldn't create the programme">
            {error}
          </Alert>
        )}
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-44 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Product</label>
            <Select value={product} onChange={(e) => setProduct(e.target.value as WaqfProgrammeProductKey)} className="w-full">
              {PRODUCT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {WAQF_PROGRAMME_PRODUCTS[k].label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500">Fixed once created.</p>
          </div>
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
