"use client";

// platform_admin-only page — the backend independently enforces this via
// StaffRoleGuard/@RequiresStaffRole on the write endpoints (see
// apps/backend/src/modules/waqf-funding/waqf-funding.controller.ts);
// this page also hides itself for other roles as a UX nicety, same
// posture as Platform Settings' own page.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { useStaffSession } from "../../../lib/staff-session";
import { Alert, Button, Card, Input, Skeleton } from "@birr/ui";

interface CorpusMinimum {
  id: string;
  currency: string;
  minAmount: string;
}

interface FundingSettings {
  id: string;
  installmentMinimumPercent: string;
}

export default function WaqfFundingPage() {
  const { staff } = useStaffSession();
  const [corpusMinimums, setCorpusMinimums] = useState<CorpusMinimum[] | null>(null);
  const [contributionMinimums, setContributionMinimums] = useState<CorpusMinimum[] | null>(null);
  const [settings, setSettings] = useState<FundingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetchJson<CorpusMinimum[]>("/waqf-funding/corpus-minimums"),
      apiFetchJson<CorpusMinimum[]>("/waqf-funding/contribution-minimums"),
      apiFetchJson<FundingSettings>("/waqf-funding/settings"),
    ])
      .then(([corpus, contribution, s]) => {
        if (cancelled) return;
        setCorpusMinimums(corpus);
        setContributionMinimums(contribution);
        setSettings(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = staff?.staffRole === "platform_admin";
  const loaded = corpusMinimums && contributionMinimums && settings;

  return (
    <div>
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Waqf Funding</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Corpus &amp; installment rules</h1>
        <p className="mt-1 text-sm text-slate-500">
          The minimum total endowment a founder may declare per currency, the minimum for a single payment toward
          it, and the minimum share of the corpus an installment plan's first payment must cover.
        </p>
      </header>

      {!isAdmin && staff && (
        <Alert tone="danger" title="platform_admin only" className="mb-6">
          Your role ({staff.staffRole}) can't view or change these — reach out to a platform admin.
        </Alert>
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load waqf funding settings">
          {error}
        </Alert>
      )}

      {!error && !loaded && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!error && loaded && isAdmin && (
        <div className="space-y-6">
          <MinimumsCard
            title="Minimum corpus per currency"
            description="The minimum total endowment a founder may declare for a new Waqf Fund."
            endpoint="/waqf-funding/corpus-minimums"
            minimums={corpusMinimums}
            onChanged={setCorpusMinimums}
          />
          <MinimumsCard
            title="Minimum contribution per currency"
            description="The floor for a single payment toward a waqf — the first payment, a later top-up, or an installment."
            endpoint="/waqf-funding/contribution-minimums"
            minimums={contributionMinimums}
            onChanged={setContributionMinimums}
          />
          <InstallmentSettingsCard settings={settings} onChanged={setSettings} />
        </div>
      )}
    </div>
  );
}

// Shared by both the corpus-minimum and contribution-minimum tables —
// same shape ({currency, minAmount}), same CRUD verbs, differing only in
// which endpoint they hit and how they're labeled.
function MinimumsCard({
  title,
  description,
  endpoint,
  minimums,
  onChanged,
}: {
  title: string;
  description: string;
  endpoint: string;
  minimums: CorpusMinimum[];
  onChanged: (next: CorpusMinimum[]) => void;
}) {
  const [newCurrency, setNewCurrency] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!newCurrency.trim() || !newAmount.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const currency = newCurrency.trim().toUpperCase();
      const updated = await apiFetchJson<CorpusMinimum>(`${endpoint}/${currency}`, {
        method: "PUT",
        body: JSON.stringify({ minAmount: newAmount }),
      });
      const existingIndex = minimums.findIndex((m) => m.currency === currency);
      onChanged(
        existingIndex >= 0
          ? minimums.map((m, i) => (i === existingIndex ? updated : m))
          : [...minimums, updated].sort((a, b) => a.currency.localeCompare(b.currency)),
      );
      setNewCurrency("");
      setNewAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <p className="mb-4 text-sm text-slate-500">{description}</p>

      {error && (
        <Alert tone="danger" title="Couldn't save" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="space-y-3">
        {minimums.map((minimum) => (
          <MinimumRow
            key={minimum.currency}
            endpoint={endpoint}
            minimum={minimum}
            onChanged={(next) => onChanged(minimums.map((m) => (m.currency === next.currency ? next : m)))}
          />
        ))}
      </div>

      <div className="mt-5 flex items-end gap-2 border-t border-slate-100 pt-5">
        <div className="w-28">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Currency</label>
          <Input value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} placeholder="e.g. AED" />
        </div>
        <div className="flex-1">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Minimum amount</label>
          <Input
            type="number"
            min="0"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={handleAdd}
          disabled={submitting || !newCurrency.trim() || !newAmount.trim()}
        >
          {submitting ? "Saving…" : "Add"}
        </Button>
      </div>
    </Card>
  );
}

function MinimumRow({
  endpoint,
  minimum,
  onChanged,
}: {
  endpoint: string;
  minimum: CorpusMinimum;
  onChanged: (next: CorpusMinimum) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(minimum.minAmount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetchJson<CorpusMinimum>(`${endpoint}/${minimum.currency}`, {
        method: "PUT",
        body: JSON.stringify({ minAmount: value }),
      });
      onChanged(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error && (
        <Alert tone="danger" title="Couldn't save" className="mb-2">
          {error}
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 font-mono text-sm text-slate-700">{minimum.currency}</span>
        {editing ? (
          <>
            <Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="flex-1" />
            <Button type="button" variant="primary" onClick={handleSave} disabled={submitting || !value.trim()}>
              {submitting ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500">
              {minimum.minAmount}
            </span>
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Change
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function InstallmentSettingsCard({
  settings,
  onChanged,
}: {
  settings: FundingSettings;
  onChanged: (next: FundingSettings) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(settings.installmentMinimumPercent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetchJson<FundingSettings>("/waqf-funding/settings", {
        method: "PUT",
        body: JSON.stringify({ installmentMinimumPercent: value }),
      });
      onChanged(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">Installment minimum</p>
      <p className="mb-4 text-sm text-slate-500">
        The minimum percentage of a declared corpus an installment plan's first payment must cover — the rest can
        be paid anytime as a top-up.
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't save" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <Input type="number" min="1" max="100" value={value} onChange={(e) => setValue(e.target.value)} className="w-28" />
            <span className="text-sm text-slate-500">%</span>
            <Button type="button" variant="primary" onClick={handleSave} disabled={submitting || !value.trim()}>
              {submitting ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500">
              {settings.installmentMinimumPercent}%
            </span>
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Change
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
