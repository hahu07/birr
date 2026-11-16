// Renders a deed's plain text (see foundation-deed-template.ts / the
// superseded WaqfDeed model) as an actual formal document rather than a
// raw <pre> dump: both the deed about to be signed
// (SignFoundationDeedForm) and a signed one (DeedDocument below).
// deedText is a fixed, predictable legal template — a two-line all-caps
// title, an opening paragraph, an all-caps "RECITALS" heading, lettered
// A/B/C recitals, then "N. UPPERCASE HEADING" sections (some carrying an
// indented "  - " bullet schedule), closing with an "IN WITNESS WHEREOF"
// paragraph — so its structure can be recovered from plain text via a
// handful of line-shape rules, entirely without touching or reordering a
// single character of the underlying legal text: every rule below only
// ever regroups/restyles, it never drops or rewrites words. Robust to a
// future template wording bump by design — anything that doesn't match
// one of these shapes just falls through to a plain paragraph, never
// breaks or loses text. Where the exact characters matter (they're what
// is stored and hashed), the signing form offers the literal text too.
import { Fragment, useMemo, type ReactNode } from "react";
import { IconMark } from "@birr/ui";

// Same serif stack IconMark's own seal glyph already uses for the "B"
// — reused here rather than introduced fresh, so the deed's formal
// document identity ties back to the one serif accent this brand
// already has, not a second unrelated typographic choice.
export const DEED_FONT = 'Georgia, Cambria, "Times New Roman", Times, serif';

const ALL_CAPS_LINE = /^[A-Z0-9 ()'".,&/-]*$/;
const NUMBERED_HEADING_LINE = /^(\d+)\.\s+([A-Z][A-Z0-9 ()'".,&/-]*)\s*$/;
const RECITAL_ITEM_START = /^([A-Z])\.\s+(.*)$/;
const BULLET_LINE = /^\s{2,}-\s+(.*)$/;
// The party who makes the deed: 'This Deed is made by NAME (the "Founder")'.
const MADE_BY = /This Deed is made by (.+?) \(the "/;

function isAllCapsLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /[A-Z]/.test(trimmed) && ALL_CAPS_LINE.test(trimmed);
}

export type DeedBlock =
  | { kind: "title"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "recitals"; items: { letter: string; text: string }[] }
  | { kind: "section"; number: string; heading: string; paragraph: string; bullets: string[] }
  | { kind: "paragraph"; text: string; emphasis: boolean };

export function parseDeedText(deedText: string): DeedBlock[] {
  const chunks = deedText
    .trim()
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split("\n"))
    .filter((lines) => lines.some((line) => line.trim().length > 0));

  const blocks: DeedBlock[] = [];

  chunks.forEach((rawLines, chunkIndex) => {
    const lines = rawLines.map((line) => line.trimEnd());

    if (chunkIndex === 0 && lines.every(isAllCapsLine)) {
      blocks.push({ kind: "title", lines: lines.map((line) => line.trim()) });
      return;
    }

    if (lines.length === 1 && isAllCapsLine(lines[0])) {
      blocks.push({ kind: "heading", text: lines[0].trim() });
      return;
    }

    const headingMatch = lines[0].trim().match(NUMBERED_HEADING_LINE);
    if (headingMatch) {
      const paragraphLines: string[] = [];
      const bullets: string[] = [];
      for (const line of lines.slice(1)) {
        const bulletMatch = line.match(BULLET_LINE);
        if (bulletMatch) {
          bullets.push(bulletMatch[1].trim());
        } else if (line.trim()) {
          paragraphLines.push(line.trim());
        }
      }
      blocks.push({
        kind: "section",
        number: headingMatch[1],
        heading: headingMatch[2].trim(),
        paragraph: paragraphLines.join(" "),
        bullets,
      });
      return;
    }

    if (RECITAL_ITEM_START.test(lines[0].trim())) {
      const items: { letter: string; text: string }[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        const itemMatch = trimmed.match(RECITAL_ITEM_START);
        if (itemMatch) {
          items.push({ letter: itemMatch[1], text: itemMatch[2] });
        } else if (items.length > 0 && trimmed) {
          items[items.length - 1].text += ` ${trimmed}`;
        }
      }
      if (items.length > 0) {
        blocks.push({ kind: "recitals", items });
        return;
      }
    }

    const text = lines
      .map((line) => line.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    blocks.push({ kind: "paragraph", text, emphasis: /^IN WITNESS WHEREOF/i.test(text) });
  });

  return blocks;
}

/** Anchor id of a clause, for the signing form's contents row. */
export function deedSectionId(number: string): string {
  return `deed-clause-${number}`;
}
export const DEED_RECITALS_ID = "deed-recitals";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bolds the parties' names and the deed's quoted defined terms
 * ("Foundation", "Signing Founder", …) so a reader can follow who is who.
 * Styling only: every character is still shown, in order.
 */
function useRichText(deedText: string, parties: string[]) {
  return useMemo(() => {
    const madeBy = deedText.match(MADE_BY)?.[1];
    const names = [...new Set([madeBy, ...parties].map((n) => n?.trim()).filter((n): n is string => Boolean(n && n.length > 1)))]
      // Longest first, so "Bello Family Foundation" wins over "Bello".
      .sort((a, b) => b.length - a.length);
    const alternatives = ['"[^"\\n]+"', ...names.map(escapeRegExp)];
    const pattern = new RegExp(`(${alternatives.join("|")})`, "g");

    return function rich(text: string): ReactNode {
      return text.split(pattern).map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        if (part.startsWith('"')) {
          return (
            <strong key={i} className="font-semibold text-primary-900">
              {part}
            </strong>
          );
        }
        return (
          <strong key={i} className="font-semibold text-slate-900">
            {part}
          </strong>
        );
      });
    };
  }, [deedText, parties]);
}

function Ornament({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-accent-400 sm:w-24" />
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-accent-500" fill="currentColor">
        <path d="M6 0 7.4 4.6 12 6 7.4 7.4 6 12 4.6 7.4 0 6 4.6 4.6Z" />
      </svg>
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-accent-400 sm:w-24" />
    </div>
  );
}

/** A schedule entry such as "Yusra Fund — Investment — NG": the name stands out, the details follow. */
function ScheduleEntry({ text }: { text: string }) {
  const [name, ...details] = text.split(" — ");
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-200/80 bg-white/70 px-3.5 py-2.5">
      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rotate-45 bg-accent-500" aria-hidden="true" />
      <span className="text-[15px] leading-relaxed text-slate-800">
        <span className="font-semibold text-slate-900">{name}</span>
        {details.length > 0 && <span className="text-slate-500"> — {details.join(" — ")}</span>}
      </span>
    </li>
  );
}

export function DeedBody({ deedText, parties = [] }: { deedText: string; parties?: string[] }) {
  const blocks = useMemo(() => parseDeedText(deedText), [deedText]);
  const rich = useRichText(deedText, parties);
  const firstParagraph = blocks.findIndex((b) => b.kind === "paragraph" && !b.emphasis);

  return (
    <div className="space-y-7" style={{ fontFamily: DEED_FONT }}>
      {blocks.map((block, i) => {
        if (block.kind === "title") {
          return (
            <header key={i} className="text-center">
              {block.lines.map((line, j) => (
                <p
                  key={j}
                  className={
                    j === 0
                      ? "text-balance text-lg font-bold tracking-[0.05em] text-primary-900 sm:text-[22px]"
                      : "mt-2 text-balance text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500"
                  }
                >
                  {line}
                </p>
              ))}
              <Ornament className="mt-6" />
            </header>
          );
        }
        if (block.kind === "heading") {
          return (
            <h3
              key={i}
              id={block.text === "RECITALS" ? DEED_RECITALS_ID : undefined}
              className="scroll-mt-4 pt-2 text-center text-xs font-bold uppercase tracking-[0.32em] text-accent-700"
            >
              {block.text}
            </h3>
          );
        }
        if (block.kind === "recitals") {
          return (
            <ol key={i} className="space-y-3.5 border-l-2 border-accent-200 pl-5">
              {block.items.map((item) => (
                <li key={item.letter} className="flex gap-3 text-[15px] leading-7 text-slate-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-50 text-xs font-bold text-accent-800 ring-1 ring-accent-200">
                    {item.letter}
                  </span>
                  <span>{rich(item.text)}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (block.kind === "section") {
          return (
            <section key={i} id={deedSectionId(block.number)} className="scroll-mt-4">
              <h3 className="flex items-center gap-3 text-[13px] font-bold uppercase tracking-[0.14em] text-primary-900">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-800 text-xs font-semibold tracking-normal text-white shadow-sm">
                  {block.number}
                </span>
                {block.heading}
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </h3>
              <div className="mt-3 sm:pl-10">
                {block.paragraph && <p className="text-[15px] leading-7 text-slate-800">{rich(block.paragraph)}</p>}
                {block.bullets.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {block.bullets.map((bullet, k) => (
                      <ScheduleEntry key={k} text={bullet} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        }
        if (block.emphasis) {
          return (
            <div key={i} className="pt-2">
              <Ornament className="mb-5" />
              <p className="mx-auto max-w-xl text-center text-[15px] italic leading-7 text-slate-600">{rich(block.text)}</p>
            </div>
          );
        }
        return (
          <p
            key={i}
            className={`text-[15px] leading-7 text-slate-800 ${
              i === firstParagraph
                ? "first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-5xl first-letter:font-bold first-letter:leading-[0.8] first-letter:text-primary-800"
                : ""
            }`}
          >
            {rich(block.text)}
          </p>
        );
      })}
    </div>
  );
}

export function DeedDocument({
  eyebrow,
  title,
  deedText,
  signedBy,
  signedAt,
  parties,
}: {
  eyebrow: string;
  title: string;
  deedText: string;
  signedBy: string;
  signedAt: string;
  parties?: string[];
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-[#fffdf8] shadow-xl print:rounded-none print:border-0 print:shadow-none">
      <div className="h-1.5 bg-gradient-to-r from-primary-700 via-accent-500 to-primary-700" aria-hidden="true" />
      <div className="m-3 rounded-xl border border-accent-200/70 px-5 py-10 sm:m-5 sm:px-12 sm:py-14 print:m-0 print:border-0">
        <div className="mb-10 flex flex-col items-center text-center">
          <IconMark className="h-12 w-12" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-accent-700">{eyebrow}</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900" style={{ fontFamily: DEED_FONT }}>
            {title}
          </h1>
        </div>

        <DeedBody deedText={deedText} parties={[title, signedBy, ...(parties ?? [])]} />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 sm:items-end">
          <div>
            <p className="border-b border-slate-300 pb-1 text-2xl italic text-slate-900" style={{ fontFamily: DEED_FONT }}>
              {signedBy}
            </p>
            <p className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Signed by</p>
          </div>
          <div className="sm:text-right">
            <p className="border-b border-slate-300 pb-1 text-base text-slate-800" style={{ fontFamily: DEED_FONT }}>
              {signedAt}
            </p>
            <p className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Date</p>
          </div>
        </div>
      </div>
      <div className="h-1.5 bg-gradient-to-r from-primary-700 via-accent-500 to-primary-700" aria-hidden="true" />
    </div>
  );
}
