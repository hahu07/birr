"use client";

// Shared deed-signing form — Foundation-level (see FoundationDeed's own
// schema comment: one deed covers this Foundation and every Waqf Fund
// under it, present and future). Used both by onboarding's step 4 (the
// founder's first Foundation, signed as part of the wizard) and by
// foundations/[id]/deed/page.tsx (any Foundation, including one
// established later). 2026-09-14 audit fix: the onboarding wizard used
// to be the ONLY place a deed could ever be signed, hardcoded to
// foundations[0] — a Waqf Fund established under any 2nd+ Foundation
// could never have its deed signed through the UI at all, even though
// the backend (POST /foundation-deeds) already accepts any foundationId.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiFetchJson } from "../../lib/api";
import { useFounderSession } from "../../lib/founder-session";
import { humanize } from "../../lib/format";
import type { Foundation, Waqf } from "../../lib/types";
import { Alert, Button, IconCheckCircle, IconFileText, IconShieldCheck, Skeleton } from "@birr/ui";
import { DEED_RECITALS_ID, DeedBody, deedSectionId, parseDeedText } from "./DeedDocument";
import { countryName } from "@birr/shared";

const MINOR_WORDS = new Set(["of", "and", "as", "the", "to", "in", "for", "a", "an", "on", "by"]);

/** "DECLARATION OF WAQF" → "Declaration of Waqf", for the contents row. */
function titleCase(heading: string): string {
  return heading
    .toLowerCase()
    .split(" ")
    .map((word, i) =>
      i > 0 && MINOR_WORDS.has(word) ? word : word.replace(/(^|-)([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase()),
    )
    .join(" ");
}

/**
 * The deed about to be signed, formatted as a document, with a contents
 * row, reading progress, and the exact stored text one click away. The
 * formatted view only restyles (see DeedDocument's parser); "Exact text"
 * shows the characters that are stored and hashed when signing.
 */
function DeedReader({ deedText, parties }: { deedText: string; parties: string[] }) {
  const [view, setView] = useState<"formatted" | "exact">("formatted");
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const contents = useMemo(() => {
    const blocks = parseDeedText(deedText);
    const items: { id: string; label: string }[] = [];
    for (const block of blocks) {
      if (block.kind === "heading" && block.text === "RECITALS") items.push({ id: DEED_RECITALS_ID, label: "Recitals" });
      if (block.kind === "section") items.push({ id: deedSectionId(block.number), label: `${block.number}. ${titleCase(block.heading)}` });
    }
    return items;
  }, [deedText]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max <= 0 ? 1 : Math.min(1, el.scrollTop / max));
    // The clause being read: the last one whose heading has reached the top third.
    const containerTop = el.getBoundingClientRect().top;
    let current: string | null = null;
    for (const item of contents) {
      const target = el.querySelector<HTMLElement>(`#${item.id}`);
      if (target && target.getBoundingClientRect().top - containerTop <= el.clientHeight / 3) current = item.id;
    }
    setActiveId(current);
  }, [contents]);

  // A different deed (or view) starts again from the top.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    onScroll();
  }, [deedText, view, onScroll]);

  function jumpTo(id: string) {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`#${id}`);
    if (!container || !target) return;
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16;
    container.scrollTo({ top, behavior: "smooth" });
  }

  const readToEnd = progress >= 0.98;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 sm:px-4">
        <div role="tablist" aria-label="How to show the deed" className="inline-flex rounded-lg bg-slate-200/70 p-0.5 text-xs font-medium">
          {(["formatted", "exact"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {v === "formatted" ? "Formatted" : "Exact text"}
            </button>
          ))}
        </div>
        <p className={`flex items-center gap-1.5 text-xs ${readToEnd ? "font-medium text-primary-700" : "text-slate-500"}`}>
          {readToEnd ? (
            <>
              <IconCheckCircle className="h-3.5 w-3.5" /> Read to the end
            </>
          ) : (
            <>{Math.round(progress * 100)}% read</>
          )}
        </p>
      </div>
      <div className="h-0.5 bg-slate-100" aria-hidden="true">
        <div className="h-full bg-gradient-to-r from-primary-600 to-accent-500 transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
      </div>

      {view === "formatted" && contents.length > 0 && (
        <nav aria-label="Deed contents" className="flex gap-1.5 overflow-x-auto border-b border-slate-100 px-3 py-2 sm:px-4">
          {contents.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => jumpTo(item.id)}
              aria-current={activeId === item.id ? "location" : undefined}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                activeId === item.id
                  ? "border-primary-600 bg-primary-700 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Full text of the Deed of Waqf"
        className="max-h-[34rem] overflow-y-auto bg-[#fffdf8] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/30"
      >
        {view === "formatted" ? (
          <div className="m-3 rounded-lg border border-accent-200/70 px-5 py-8 sm:m-4 sm:px-10 sm:py-10">
            <DeedBody deedText={deedText} parties={parties} />
          </div>
        ) : (
          <div className="p-4 sm:p-6">
            <p className="mb-3 text-xs text-slate-500">
              Exactly as stored when you sign — the formatted view shows these same words, laid out for reading.
            </p>
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-6 text-slate-700">{deedText}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// GET /foundation-deeds/:foundationId/preview — the deed exactly as it
// would be stored if signed now (see FoundationDeedsService.preview).
interface DeedPreview {
  deedText: string;
  textHash: string;
  joint: boolean;
  coFounders: string[];
  /** Co-founders who must agree before this deed can be signed for them. */
  awaitingConsent: string[];
}

// POST /foundation-deeds/:foundationId/consent-reminders — who was just
// reminded to agree, who already was today, and who has no one to agree.
interface ReminderResult {
  reminded: string[];
  alreadyReminded: string[];
  noPrimaryContact: string[];
}

/** "Yusuf", "Yusuf and Hauwa", "Yusuf, Hauwa and Musa". */
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Same comparison the backend makes (FoundationDeedsService: trimmed, case-insensitive). */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function SignFoundationDeedForm({ foundation, onSigned }: { foundation: Foundation; onSigned: () => void }) {
  const { user } = useFounderSession();
  const [activeWaqfs, setActiveWaqfs] = useState<Waqf[] | null>(null);
  const [preview, setPreview] = useState<DeedPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [typedLegalName, setTypedLegalName] = useState("");
  const [affirmed, setAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<ReminderResult | null>(null);

  // The deed text and the funds listed beside it always come from the same
  // load, so they can't disagree. No GET /foundations/:id/waqfs endpoint
  // exists — /waqfs already returns every waqf this founder session can
  // see, so filtering to this one Foundation client-side is simpler.
  const load = useCallback(
    () =>
      Promise.all([apiFetchJson<Waqf[]>("/waqfs"), apiFetchJson<DeedPreview>(`/foundation-deeds/${foundation.id}/preview`)]).then(
        ([waqfs, deedPreview]) => ({ waqfs: waqfs.filter((w) => w.foundationId === foundation.id && w.status === "active"), deedPreview }),
      ),
    [foundation.id],
  );

  useEffect(() => {
    let cancelled = false;
    load()
      .then(({ waqfs, deedPreview }) => {
        if (cancelled) return;
        setActiveWaqfs(waqfs);
        setPreview(deedPreview);
        // Waiting for co-founders: remind them, so the signer needn't chase
        // them. The backend sends each at most one reminder a day.
        if (deedPreview.awaitingConsent.length > 0) {
          apiFetchJson<ReminderResult>(`/foundation-deeds/${foundation.id}/consent-reminders`, { method: "POST" })
            .then((result) => !cancelled && setReminders(result))
            .catch(() => {});
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [load, foundation.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/foundation-deeds", {
        method: "POST",
        body: JSON.stringify({ foundationId: foundation.id, typedLegalName, affirmed, textHash: preview?.textHash }),
      });
      onSigned();
    } catch (err) {
      // Someone else (a co-founder, another tab) signed it first: show the signed deed.
      if (err instanceof ApiError && err.code === "deed_already_signed") {
        onSigned();
        return;
      }
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
      // The deed changed since it was shown (a fund went active, a
      // co-founder joined), or a co-founder still has to agree. Show the
      // current text and funds together, and make them affirm again.
      if (err instanceof ApiError && err.status === 409) {
        setAffirmed(false);
        load()
          .then(({ waqfs, deedPreview }) => {
            setActiveWaqfs(waqfs);
            setPreview(deedPreview);
          })
          .catch(() => {});
      }
    }
  }

  const hasActiveWaqf = Boolean(activeWaqfs?.length);
  const awaiting = preview?.awaitingConsent ?? [];
  const canSubmit = hasActiveWaqf && awaiting.length === 0 && typedLegalName.trim().length > 0 && affirmed && !submitting;

  if (loadError) {
    return (
      <Alert tone="danger" title="Couldn't load this Foundation's Waqf Funds">
        {loadError}
      </Alert>
    );
  }
  if (activeWaqfs === null || preview === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  const nameMatches = Boolean(user && typedLegalName.trim() && sameName(typedLegalName, user.fullName));
  const today = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date());

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {submitError && (
        <Alert tone="danger" title="Couldn't sign the deed">
          {submitError}
        </Alert>
      )}

      {awaiting.length > 0 && (
        <Alert tone="warning" title={`Waiting for ${awaiting.join(", ")} to agree`}>
          You sign this deed for every co-founder of {foundation.name}, so each must first agree to that in their own name. They&apos;ll
          find it on this Foundation&apos;s deed page. You can sign once they have.
          {reminders && reminders.reminded.length > 0 && (
            <span className="mt-1.5 block">We&apos;ve just reminded {listNames(reminders.reminded)} by email and WhatsApp.</span>
          )}
          {reminders && reminders.alreadyReminded.length > 0 && (
            <span className="mt-1.5 block">{listNames(reminders.alreadyReminded)} had a reminder in the last day.</span>
          )}
          {reminders && reminders.noPrimaryContact.length > 0 && (
            <span className="mt-1.5 block">
              {listNames(reminders.noPrimaryContact)} {reminders.noPrimaryContact.length === 1 ? "has" : "have"} no one who can sign in to agree.
              Contact Birr.
            </span>
          )}
        </Alert>
      )}

      {!hasActiveWaqf && (
        <Alert tone="warning" title="Fund your first Waqf Fund before signing">
          You need at least one active (funded) Waqf Fund under {foundation.name} before Birr can be formally
          appointed as Mutawalli (trustee).
        </Alert>
      )}

      <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-primary-700 via-primary-500 to-accent-500" />
        <div className="px-6 py-8 sm:px-10">
          <div className="text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700 ring-1 ring-primary-100">
              <IconFileText className="h-5 w-5" />
            </span>
            <h2 className="font-display mt-4 text-2xl font-medium tracking-tight text-slate-900">Deed of Waqf</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{foundation.name}</p>
          </div>

          <dl className="mt-8 grid gap-4 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-500">Foundation</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{foundation.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Mutawalli (trustee)</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">Birr</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Signed by</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{user?.fullName ?? "—"}</dd>
            </div>
          </dl>

          {preview.joint && (
            <p className="mt-4 rounded-xl border border-primary-100 bg-primary-50/60 p-4 text-sm leading-relaxed text-slate-700">
              <span className="font-semibold text-slate-900">A joint deed.</span> You sign it for yourself and every co-founder of{" "}
              {foundation.name}, present and future
              {preview.coFounders.length > 0 ? <> — today, {preview.coFounders.join(", ")}</> : ""}. Each co-founder agrees to it, in
              their own name, before you can sign it for them.
            </p>
          )}

          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">In short</p>
          <p className="mt-2 text-[15px] leading-7 text-slate-700">
            This deed records the establishment of <span className="font-medium">{foundation.name}</span> and
            appoints Birr as Mutawalli (trustee) over every Waqf Fund established under it — including funds you
            establish in the future. By signing below, you irrevocably dedicate the assets contributed to each such
            Waqf Fund as waqf (Islamic endowment), to be administered in accordance with applicable Shariah
            governance standards and each fund&apos;s own jurisdiction&apos;s regulatory requirements. This
            appointment takes effect upon signature.
          </p>

          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">The full deed — what you&apos;re signing</p>
          <DeedReader deedText={preview.deedText} parties={[foundation.name, ...preview.coFounders]} />

          {hasActiveWaqf && (
            <div className="mt-8">
              <p id="deed-funds-covered" className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Waqf Funds covered as of today
              </p>
              <ul aria-labelledby="deed-funds-covered" className="mt-3 space-y-2">
                {activeWaqfs!.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      <IconCheckCircle className="h-4 w-4 shrink-0 text-primary-600" />
                      {w.name}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {humanize(w.type)} · {countryName(w.jurisdiction)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Any Waqf Fund you establish under this Foundation later is covered too.</p>
            </div>
          )}

          <div className="mt-10 grid gap-6 border-t border-slate-200 pt-8 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label htmlFor="typedLegalName" className="block text-sm font-medium text-slate-800">
                Type your full legal name to sign
              </label>
              {/* The input is the signature line itself: what's typed appears in a signature style. */}
              <input
                id="typedLegalName"
                value={typedLegalName}
                onChange={(e) => setTypedLegalName(e.target.value)}
                placeholder={user?.fullName ?? "Your full legal name"}
                required
                disabled={!hasActiveWaqf}
                autoComplete="name"
                className="font-display mt-3 w-full border-0 border-b-2 border-slate-300 bg-transparent px-0 pb-1 text-3xl italic text-slate-900 placeholder:text-slate-300 focus:border-primary-600 focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
              />
              <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${nameMatches ? "font-medium text-primary-700" : "text-slate-500"}`}>
                {nameMatches ? (
                  <>
                    <IconCheckCircle className="h-3.5 w-3.5" /> Matches your registered name
                  </>
                ) : user ? (
                  <>
                    Must match your registered name: <span className="font-medium text-slate-700">{user.fullName}</span>
                  </>
                ) : (
                  "Must match your account's registered name."
                )}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium text-slate-500">Date</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">{today}</p>
            </div>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 text-sm text-slate-700 transition-colors hover:border-slate-300 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50/70">
            <input
              type="checkbox"
              checked={affirmed}
              onChange={(e) => setAffirmed(e.target.checked)}
              disabled={!hasActiveWaqf}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700"
            />
            <span>
              I have read and agree to the deed above, and I am authorized to sign on behalf of this Founder
              account.
            </span>
          </label>
        </div>
      </article>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <IconShieldCheck className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-sm text-slate-600">
                {canSubmit ? "Ready to sign." : awaiting.length > 0 ? "Waiting for every co-founder to agree." : "Type your name and tick the box to sign."}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Signing appoints Birr as Mutawalli (trustee). It takes effect immediately.</p>
            </div>
          </div>
          <Button type="submit" variant="primary" disabled={!canSubmit} className="shrink-0 rounded-lg px-5 py-2.5 font-semibold">
            {submitting ? "Signing…" : "Sign deed"}
          </Button>
        </div>
      </div>
    </form>
  );
}
