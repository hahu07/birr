"use client";

// A clinic waqf's public giving page (2026-11-17, clinic slice 3). Anyone
// can give, with no account, to one of its two pots: the endowment (kept
// for ever; the giver accepts the waqf's deed) or the running fund
// (spent on subsidised visits and running costs). A signed-in Founder
// gives as themselves (slice 4a): recorded in their Founder Portal, first
// gift from ₦250,000. Anyone else can sign up as a Founder from here. The
// fuller public page, with targets and the monthly report, comes later.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { processingFeeCover } from "@birr/zakah";
import { Alert, Button, Card, IconHeart, Input, Select, Skeleton } from "@birr/ui";
import { ApiError, apiFetchJson } from "../../../../lib/api";
import { formatMoney } from "../../../../lib/format";
import { SiteFooter, SiteHeader } from "../../SiteChrome";
import { contactPayload, contactReady, EMPTY_CONTACT, GiverContactFields, type GiverContactValue } from "../../_components/GiverContactFields";
import { useFounderSession } from "../../../../lib/founder-session";
import { setReturnTo } from "../../../../lib/return-to";
import Link from "next/link";

interface GivingTerms {
  clinic: { name: string; slug: string; city: string; description: string | null };
  available: boolean;
  currency: string;
  minimumAmount: string;
  deed: { id: string; version: number; text: string; textHash: string } | null;
}

type Pot = "endowment" | "running";

const POTS: { pot: Pot; title: string; body: string }[] = [
  {
    pot: "endowment",
    title: "Endow it",
    body: "Your gift is kept for ever: it's never spent, and its income pays for care. You give it as a waqf, under the deed below.",
  },
  {
    pot: "running",
    title: "Give to the running fund",
    body: "Your gift is spent on subsidised visits for women and children who can't afford them, and the clinic's running costs.",
  },
];

const ID_TYPES = [
  { value: "national_id", label: "National ID (NIN)" },
  { value: "passport", label: "International passport" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "other", label: "Other" },
];

export default function ClinicGivingPage() {
  const { slug } = useParams<{ slug: string }>();
  const { founder, loading: sessionLoading } = useFounderSession();
  const [terms, setTerms] = useState<GivingTerms | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A signed-in Founder gives as themselves unless they choose otherwise.
  const [asFounder, setAsFounder] = useState(true);
  const founderMode = Boolean(founder) && asFounder;

  useEffect(() => {
    if (sessionLoading) return;
    const path = founderMode ? `/clinic-gifts/founder/terms/${encodeURIComponent(slug)}` : `/clinic-gifts/terms/${encodeURIComponent(slug)}`;
    apiFetchJson<GivingTerms>(path)
      .then(setTerms)
      .catch((err: unknown) => setLoadError(err instanceof ApiError && err.status === 404 ? "We couldn't find this clinic." : "Something went wrong."));
  }, [slug, founderMode, sessionLoading]);

  function startFounderAccount(route: "/sign-up" | "/sign-in") {
    setReturnTo(`/clinics/${slug}`);
    window.location.assign(route);
  }

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <section className="bg-gradient-to-b from-primary-50/60 via-white to-white px-4 pb-16 pt-12 sm:px-8 sm:pt-16">
        <div className="mx-auto max-w-xl">
          {loadError && <Alert tone="danger" title={loadError} />}
          {!loadError && !terms && (
            <div className="space-y-3">
              <Skeleton className="h-9 w-72" />
              <Skeleton className="h-5 w-full" />
            </div>
          )}
          {terms && (
            <>
              <div className="text-center">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
                  <IconHeart className="h-5 w-5" />
                </span>
                <h1 className="font-display mt-4 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">{terms.clinic.name}</h1>
                <p className="mt-2 text-sm text-slate-500">A laboratory and clinic for women and young children in {terms.clinic.city}, held in a waqf with Birr as trustee.</p>
                {terms.clinic.description && <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-slate-600">{terms.clinic.description}</p>}
              </div>
              <Card className="mt-8">
                {terms.available ? (
                  <>
                    {founder && (
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-50/70 px-3 py-2 text-sm text-slate-700">
                        <span>{founderMode ? <>Giving as <strong>{founder.name}</strong>, recorded in your Founder Portal.</> : "Giving without your Founder account."}</span>
                        <button type="button" className="text-xs font-medium text-primary-700 hover:text-primary-800" onClick={() => setAsFounder((v) => !v)}>
                          {founderMode ? "Give without it" : `Give as ${founder.name}`}
                        </button>
                      </div>
                    )}
                    <GiveForm key={founderMode ? "founder" : "public"} terms={terms} founderMode={founderMode} />
                  </>
                ) : (
                  <p className="text-center text-sm text-slate-600">This clinic isn&apos;t taking gifts yet. Please check back soon.</p>
                )}
              </Card>
              {terms.available && !founder && !sessionLoading && (
                <Card className="mt-4">
                  <p className="text-sm font-medium text-slate-900">Giving ₦250,000 or more? Support it as a Founder.</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Your gifts are recorded under your name in your own Founder Portal, with statements for your records. You won&apos;t need to set
                    up a Foundation. Your first gift is at least ₦250,000; later gifts from ₦5,000.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button className="px-3 py-1.5 text-xs" onClick={() => startFounderAccount("/sign-up")}>
                      Sign up as a Founder
                    </Button>
                    <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => startFounderAccount("/sign-in")}>
                      I already have an account
                    </Button>
                  </div>
                </Card>
              )}
              {founder && (
                <p className="mt-4 text-center text-xs text-slate-500">
                  <Link href="/clinic-support" className="font-medium text-primary-700 hover:text-primary-800">
                    Your clinic support
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

function GiveForm({
  terms,
  founderMode = false,
  redirectTo = (url: string) => window.location.assign(url),
}: {
  terms: GivingTerms;
  /** A signed-in Founder: no contact or ID fields; the receipt goes to their account. */
  founderMode?: boolean;
  redirectTo?: (url: string) => void;
}) {
  const [pot, setPot] = useState<Pot>("endowment");
  const [amount, setAmount] = useState("");
  const [coverFee, setCoverFee] = useState(false);
  const [contact, setContact] = useState<GiverContactValue>(EMPTY_CONTACT);
  const [fullName, setFullName] = useState("");
  const [idType, setIdType] = useState("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [acceptedDeed, setAcceptedDeed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = amount.replace(/[,\s₦]/g, "");
  const validAmount = /^\d+(\.\d{1,2})?$/.test(clean) && Number(clean) >= Number(terms.minimumAmount);
  const fee = useMemo(() => (validAmount ? processingFeeCover(clean) : null), [validAmount, clean]);
  const total = validAmount ? Number(clean) + (coverFee && fee ? Number(fee) : 0) : null;
  const deedOk = pot === "running" || acceptedDeed;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { clientPayload } = await apiFetchJson<{ clientPayload: { checkoutUrl: string } }>(founderMode ? "/clinic-gifts/founder" : "/clinic-gifts", {
        method: "POST",
        body: JSON.stringify({
          slug: terms.clinic.slug,
          pot,
          amount: clean,
          coverFee,
          ...(pot === "endowment" && terms.deed && { deedId: terms.deed.id, deedTextHash: terms.deed.textHash }),
          ...(!founderMode && {
            ...contactPayload(contact, { email: "donorEmail", whatsapp: "donorWhatsApp" }),
            donorFullName: fullName.trim() || undefined,
            ...(needsIdentity && { idType, idNumber }),
          }),
        }),
      });
      redirectTo(clientPayload.checkoutUrl);
    } catch (err) {
      if (err instanceof ApiError && ["IDENTITY_REQUIRED", "IDENTITY_CONFIRMATION_REQUIRED"].includes(err.code ?? "")) setNeedsIdentity(true);
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1.5 text-sm font-medium text-slate-700">How would you like to give?</legend>
        {POTS.map((p) => (
          <label
            key={p.pot}
            className="flex cursor-pointer flex-col gap-1 rounded-xl border border-slate-200 p-3 text-sm has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50/60"
          >
            <span className="flex items-center gap-2 font-medium text-slate-900">
              <input type="radio" name="pot" value={p.pot} checked={pot === p.pot} onChange={() => setPot(p.pot)} className="h-4 w-4" />
              {p.title}
            </span>
            <span className="text-xs leading-relaxed text-slate-600">{p.body}</span>
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor="gift-amount" className="mb-1.5 block text-sm font-medium text-slate-700">
          Amount
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">₦</span>
          <Input id="gift-amount" inputMode="decimal" className="pl-7 tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
        </div>
        {amount && !validAmount && (
          <p className="mt-1 text-xs text-red-600">Enter at least {formatMoney(terms.minimumAmount, terms.currency)}, like 10000.</p>
        )}
      </div>

      {fee && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} />
          <span>
            Add {formatMoney(fee, terms.currency)} to cover the processing fee. Either way your whole gift reaches the clinic — if you
            don&apos;t, Birr pays the fee from its own funds.
          </span>
        </label>
      )}

      {!founderMode && (
        <GiverContactFields
          idPrefix="gift"
          value={contact}
          onChange={setContact}
          required={false}
          legend="Send my receipt to"
          emailLabel={
            <>
              Email for your receipt <span className="font-normal text-slate-500">(optional)</span>
            </>
          }
          emailHint={!contact.email.trim() ? "Without an email or WhatsApp number we can't send you a receipt." : undefined}
        />
      )}

      {needsIdentity && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-slate-700">For gifts of this size we&apos;re required to confirm who you are.</p>
          <div>
            <label htmlFor="gift-name" className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
            <Input check="name" id="gift-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="gift-id-type" className="mb-1.5 block text-sm font-medium text-slate-700">ID type</label>
              <Select id="gift-id-type" className="w-full" value={idType} onChange={(e) => setIdType(e.target.value)}>
                {ID_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="gift-id-number" className="mb-1.5 block text-sm font-medium text-slate-700">ID number</label>
              <Input check="reference" id="gift-id-number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {pot === "endowment" && terms.deed && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">The waqf&apos;s deed (version {terms.deed.version})</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700">
            {terms.deed.text}
          </pre>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300" checked={acceptedDeed} onChange={(e) => setAcceptedDeed(e.target.checked)} />
            <span>I give this as a waqf under this deed: it is endowed for ever and can&apos;t be given back.</span>
          </label>
        </div>
      )}

      {error && (
        <Alert tone="danger" title="That didn't work">
          {error}
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={!validAmount || !deedOk || submitting || (!founderMode && !contactReady(contact, false))}>
        {submitting ? "Taking you to payment…" : total !== null ? `Give ${formatMoney(String(total), terms.currency)}` : "Give"}
      </Button>
      <p className="text-center text-xs text-slate-500">You&apos;ll pay securely with Paystack — card, bank transfer or USSD.</p>
    </form>
  );
}
