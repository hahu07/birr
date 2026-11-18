"use client";

// A waqf programme's public giving page (2026-11-17, clinic slice 3; shared
// by every product since need-based NB3). Anyone can give, with no
// account, to one of its two pots: the endowment (kept for ever; the giver
// accepts the waqf's deed) or the running pot (a clinic's running fund, a
// need-based waqf's spending fund). A signed-in Founder gives as themselves
// (slice 4a): recorded in their Founder Portal, first gift from ₦250,000.
// Anyone else can sign up as a Founder from here. What each product's page
// says is in lib/programme-copy.ts; a product's own extras (a clinic's
// public report) come in as children.
import { useEffect, useMemo, useState } from "react";
import { processingFeeCover } from "@birr/zakah";
import { Alert, Button, Card, IconHeart, Input, Select, Skeleton } from "@birr/ui";
import type { WaqfProgrammeProductKey } from "@birr/shared";
import { ApiError, apiFetchJson } from "../../../lib/api";
import { formatMoney } from "../../../lib/format";
import { SiteFooter, SiteHeader } from "../SiteChrome";
import { contactPayload, contactReady, EMPTY_CONTACT, GiverContactFields, type GiverContactValue } from "./GiverContactFields";
import { useFounderSession } from "../../../lib/founder-session";
import { setReturnTo } from "../../../lib/return-to";
import { programmeCopy, programmePath, type ProgrammeCopy } from "../../../lib/programme-copy";
import Link from "next/link";

interface GivingTerms {
  clinic: { name: string; slug: string; city: string; description: string | null; product: WaqfProgrammeProductKey };
  available: boolean;
  currency: string;
  minimumAmount: string;
  deed: { id: string; version: number; text: string; textHash: string } | null;
}

type Pot = "endowment" | "running";


const ID_TYPES = [
  { value: "national_id", label: "National ID (NIN)" },
  { value: "passport", label: "International passport" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "other", label: "Other" },
];

export function ProgrammeGivingPage({ product, slug, children }: { product: WaqfProgrammeProductKey; slug: string; children?: React.ReactNode }) {
  const copy = programmeCopy(product);
  const { founder, loading: sessionLoading } = useFounderSession();
  const [terms, setTerms] = useState<GivingTerms | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A signed-in Founder gives as themselves unless they choose otherwise.
  const [asFounder, setAsFounder] = useState(true);
  const founderMode = Boolean(founder) && asFounder;

  useEffect(() => {
    if (sessionLoading) return;
    const path = founderMode ? `/programme-gifts/founder/terms/${encodeURIComponent(slug)}` : `/programme-gifts/terms/${encodeURIComponent(slug)}`;
    apiFetchJson<GivingTerms>(path)
      // A programme of another product isn't found at this address.
      .then((t) => (t.clinic.product === product ? setTerms(t) : setLoadError("We couldn't find this page.")))
      .catch((err: unknown) => setLoadError(err instanceof ApiError && err.status === 404 ? "We couldn't find this page." : "Something went wrong."));
  }, [slug, product, founderMode, sessionLoading]);

  function startFounderAccount(route: "/sign-up" | "/sign-in") {
    setReturnTo(programmePath(product, slug));
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
                <p className="mt-2 text-sm text-slate-500">{copy.subtitle(terms.clinic.city)}</p>
                {terms.clinic.description && <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-slate-600">{terms.clinic.description}</p>}
              </div>
              {copy.notice && (
                <Alert tone="info" title="Support hasn't started yet" className="mt-6">
                  {copy.notice}
                </Alert>
              )}
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
                    <GiveForm key={founderMode ? "founder" : "public"} terms={terms} copy={copy} founderMode={founderMode} />
                  </>
                ) : (
                  <p className="text-center text-sm text-slate-600">{copy.notTakingGifts}</p>
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
                    Your gifts, in your Founder Portal
                  </Link>
                </p>
              )}
              {children}
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
  copy,
  founderMode = false,
  redirectTo = (url: string) => window.location.assign(url),
}: {
  terms: GivingTerms;
  copy: ProgrammeCopy;
  /** A signed-in Founder: no contact or ID fields; the receipt goes to their account. */
  founderMode?: boolean;
  redirectTo?: (url: string) => void;
}) {
  const [pot, setPot] = useState<Pot>("endowment");
  const [amount, setAmount] = useState("");
  const [coverFee, setCoverFee] = useState(false);
  // Monthly giving (slice 4b): by card, the same amount each month; a public giver needs an email or WhatsApp number.
  const [monthly, setMonthly] = useState(false);
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
      const { clientPayload } = await apiFetchJson<{ clientPayload: { checkoutUrl: string } }>(founderMode ? "/programme-gifts/founder" : "/programme-gifts", {
        method: "POST",
        body: JSON.stringify({
          slug: terms.clinic.slug,
          pot,
          amount: clean,
          coverFee,
          ...(monthly && { monthly: true }),
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
        {(["endowment", "running"] as const).map((pot) => ({ pot, ...copy.pots[pot] })).map((p) => (
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
            Add {formatMoney(fee, terms.currency)} to cover the processing fee. Either way your whole gift reaches {copy.giftReaches} — if you
            don&apos;t, Birr pays the fee from its own funds.
          </span>
        </label>
      )}

      <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 has-[:checked]:border-primary-300 has-[:checked]:bg-primary-50/60">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
        <span>
          <span className="font-medium text-slate-900">Give this every month</span>
          {monthly && (
            <span className="mt-1 block text-xs leading-relaxed text-slate-600">
              We charge your card the same amount each month and remind you before each charge.{" "}
              {founderMode ? "You can change or stop it from your Founder Portal." : "We'll send you a private link to change or stop it any time."}
              {pot === "endowment" && " If the waqf's deed is ever revised, we'll pause it until you've read and accepted the new version."}
            </span>
          )}
        </span>
      </label>

      {!founderMode && (
        <GiverContactFields
          idPrefix="gift"
          value={contact}
          onChange={setContact}
          required={monthly}
          legend={monthly ? "Send receipts and reminders to" : "Send my receipt to"}
          emailLabel={
            monthly ? (
              "Email"
            ) : (
              <>
                Email for your receipt <span className="font-normal text-slate-500">(optional)</span>
              </>
            )
          }
          emailHint={
            monthly
              ? "For your receipts, reminders, and the link to manage your monthly gift."
              : !contact.email.trim()
                ? "Without an email or WhatsApp number we can't send you a receipt."
                : undefined
          }
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

      <Button type="submit" className="w-full" disabled={!validAmount || !deedOk || submitting || (!founderMode && !contactReady(contact, monthly))}>
        {submitting
          ? "Taking you to payment…"
          : total !== null
            ? `Give ${formatMoney(String(total), terms.currency)}${monthly ? " now, then monthly" : ""}`
            : "Give"}
      </Button>
      <p className="text-center text-xs text-slate-500">
        {monthly
          ? "You'll pay securely with Paystack, by card: only a card can be charged again each month."
          : "You'll pay securely with Paystack — card, bank transfer or USSD."}
      </p>
    </form>
  );
}
