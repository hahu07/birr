"use client";

// Public Vault donation page — the destination the homepage's "Give to
// this vault" cards link to (app/(founder)/MarketingHome.tsx). No
// session, no Founder involvement at all: GET /vaults/by-slug/:slug is
// @Public() and only ever returns a vault whose status is "open" (see
// VaultsController.findBySlug's own comment — a draft/closed vault's
// page is deliberately unreachable by slug, not just unlisted).
// Contribution submission mirrors WaqfFundForm.tsx's own
// POST /contributions -> redirect-to-checkoutUrl pattern, since every
// PaymentProviderAdapter (stripe/paystack/stablecoin) returns the same
// { checkoutUrl } clientPayload shape regardless of rail.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import type { Vault, VaultCause } from "../../../../lib/types";
import { Alert, Button, Card, IconArchive, Input, Skeleton } from "@birr/ui";
import { GRADIENT, SiteFooter, SiteHeader } from "../../SiteChrome";

// Same rail/currency map as WaqfFundForm's own PROVIDERS — a vault's
// currency is fixed (not user-editable, unlike the Founder flow's own
// corpus-currency picker), so this only ever filters which providers
// are even offered for it.
const PROVIDERS = [
  { value: "stripe", label: "Card (international)", currencies: ["USD", "EUR", "GBP"] },
  { value: "paystack", label: "Card (Nigeria)", currencies: ["NGN"] },
  { value: "stablecoin", label: "Stablecoin", currencies: ["USDC", "USDT"] },
] as const;

const ID_TYPES = ["passport", "national_id", "drivers_license", "other"] as const;

interface ContributionMinimum {
  currency: string;
  minAmount: string;
}

export default function VaultDonationPage() {
  const { slug } = useParams<{ slug: string }>();
  const [vault, setVault] = useState<Vault | null | undefined>(undefined);
  const [minimums, setMinimums] = useState<ContributionMinimum[]>([]);

  useEffect(() => {
    apiFetchJson<Vault>(`/vaults/by-slug/${slug}`)
      .then(setVault)
      .catch(() => setVault(null));
    apiFetchJson<ContributionMinimum[]>("/waqf-funding/contribution-minimums").then(setMinimums).catch(() => setMinimums([]));
  }, [slug]);

  if (vault === undefined) {
    return (
      <div className="min-h-screen bg-white">
        <SiteHeader />
        <div className="mx-auto max-w-3xl space-y-3 px-6 py-16 sm:px-8">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
      </div>
    );
  }

  if (vault === null) {
    return (
      <div className="min-h-screen bg-white">
        <SiteHeader />
        <div className="mx-auto max-w-xl px-6 py-24 text-center sm:px-8">
          <h1 className="text-xl font-semibold text-slate-900">This vault isn't open right now.</h1>
          <p className="mt-2 text-sm text-slate-600">
            It may not have been published yet, or it's since closed. Take a look at what's currently open instead.
          </p>
          <Link href="/vaults" className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800">
            ← Back to open vaults
          </Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const minimum = minimums.find((m) => m.currency === vault.currency);
  const causes = vault.causes ?? [];
  // Same progress treatment as VaultCard (SiteChrome.tsx) — kept
  // consistent rather than each page inventing its own since a donor
  // may see both before deciding to give.
  const target = vault.targetAmount ? Number(vault.targetAmount) : null;
  const raised = Number(vault.amountRaised);
  const pct = target && target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : null;

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <div className="relative overflow-hidden" style={vault.coverImageUrl ? undefined : { backgroundImage: GRADIENT }}>
        {vault.coverImageUrl && <img src={vault.coverImageUrl} alt="" className="h-56 w-full object-cover" />}
        {!vault.coverImageUrl && (
          <div className="flex h-40 items-center justify-center">
            <IconArchive className="h-12 w-12 text-white/70" />
          </div>
        )}
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">{humanize(vault.type)} vault</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{vault.name}</h1>
        {vault.description && <p className="mt-3 text-sm leading-relaxed text-slate-600">{vault.description}</p>}

        {causes.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {causes.map((c) => (
              <span key={c.id} className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                {c.name}
              </span>
            ))}
          </div>
        )}

        {(pct !== null || raised > 0) && (
          <div className="mt-6">
            {pct !== null ? (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-primary-600 transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-900">
                    {vault.currency} {raised.toLocaleString()} <span className="font-normal text-slate-500">raised</span>
                  </span>
                  <span className="text-slate-500">
                    of {vault.currency} {target!.toLocaleString()} goal
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-900">
                  {vault.currency} {raised.toLocaleString()}
                </span>{" "}
                raised so far
              </p>
            )}
          </div>
        )}

        <div className="mt-8">
          <ContributionForm vault={vault} causes={causes} minimumAmount={minimum?.minAmount} />
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

function ContributionForm({
  vault,
  causes,
  minimumAmount,
}: {
  vault: Vault;
  causes: VaultCause[];
  minimumAmount: string | undefined;
}) {
  const availableProviders = PROVIDERS.filter((p) => (p.currencies as readonly string[]).includes(vault.currency));

  const [amount, setAmount] = useState("");
  const [vaultCauseId, setVaultCauseId] = useState("");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["value"]>(availableProviders[0]?.value ?? "stripe");
  const [donorEmail, setDonorEmail] = useState("");
  const [donorFullName, setDonorFullName] = useState("");
  const [showIdentity, setShowIdentity] = useState(false);
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number]>("passport");
  const [idNumber, setIdNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { clientPayload } = await apiFetchJson<{ clientPayload: { checkoutUrl: string } }>("/vault-contributions", {
        method: "POST",
        body: JSON.stringify({
          vaultId: vault.id,
          vaultCauseId: vaultCauseId || undefined,
          amount,
          currency: vault.currency,
          provider,
          donorEmail: donorEmail || undefined,
          donorFullName: donorFullName || undefined,
          idType: showIdentity ? idType : undefined,
          idNumber: showIdentity && idNumber ? idNumber : undefined,
        }),
      });
      window.location.href = clientPayload.checkoutUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      // The backend only asks for identity once a compliance threshold
      // is actually crossed (see VaultContributionsService
      // .findOrCreateDonor's own comment) — most donors never see this,
      // so the fields stay hidden until the server says they're needed.
      if (message.includes("ID for compliance")) {
        setShowIdentity(true);
      }
      setError(message);
      setSubmitting(false);
    }
  }

  if (availableProviders.length === 0) {
    return (
      <Alert tone="warning" title="No payment method available">
        This vault's currency ({vault.currency}) isn't currently supported by any payment method.
      </Alert>
    );
  }

  return (
    <Card tone="neutral">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <Alert tone="danger" title="Couldn't process your contribution">
            {error}
          </Alert>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount ({vault.currency})</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {minimumAmount && (
            <p className="mt-1 text-xs text-slate-500">
              Minimum contribution: {vault.currency} {formatMinimum(minimumAmount)}
            </p>
          )}
        </div>

        {causes.length > 0 && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Support a specific cause (optional)</label>
            <select
              value={vaultCauseId}
              onChange={(e) => setVaultCauseId(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">Wherever it's needed most</option>
              {causes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Payment method</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number]["value"])}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {availableProviders.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email (optional)</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={donorEmail}
              onChange={(e) => setDonorEmail(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              For your receipt — leave blank to give anonymously (no receipt, and larger anonymous gifts skip our
              usual identity check).
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Full name (optional)</label>
            <Input value={donorFullName} onChange={(e) => setDonorFullName(e.target.value)} />
          </div>
        </div>

        {!showIdentity && (
          <button
            type="button"
            onClick={() => setShowIdentity(true)}
            className="text-xs font-medium text-primary-700 hover:underline"
          >
            Add identity details
          </button>
        )}

        {showIdentity && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs text-slate-500">
              Required for larger contributions, for compliance — your ID details are encrypted and never shown publicly.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">ID type</label>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value as (typeof ID_TYPES)[number])}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {ID_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {humanize(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">ID number</label>
                <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Processing…" : "Continue to payment"}
        </Button>
      </form>
    </Card>
  );
}

function formatMinimum(amount: string) {
  return Number(amount).toLocaleString();
}
