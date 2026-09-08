// Renders a signed deed's stored deedText (see
// foundation-deed-template.ts / the superseded WaqfDeed model) as an
// actual formal document rather than a raw <pre> dump. deedText is a
// fixed, predictable legal template — a two-line all-caps title, an
// intro paragraph, an all-caps "RECITALS" heading, lettered A/B/C
// recitals, then "N. UPPERCASE HEADING" sections (one of which carries
// an indented "  - " bullet schedule), closing with an "IN WITNESS
// WHEREOF" paragraph — so its structure can be recovered from plain
// text via a handful of line-shape rules, entirely without touching or
// reordering a single character of the underlying legal text: every
// rule below only ever regroups/restyles, it never drops or rewrites
// words. Robust to a future template wording bump
// (FOUNDATION_DEED_TEMPLATE_VERSION) by design — anything that doesn't
// match one of these shapes just falls through to a plain paragraph,
// never breaks or loses text.
import { useMemo } from "react";
import { IconMark } from "@birr/ui";

// Same serif stack IconMark's own seal glyph already uses for the "B"
// — reused here rather than introduced fresh, so the deed's formal
// document identity ties back to the one serif accent this brand
// already has, not a second unrelated typographic choice.
const DEED_FONT = 'Georgia, Cambria, "Times New Roman", Times, serif';

const ALL_CAPS_LINE = /^[A-Z0-9 ()'".,&/-]*$/;
const NUMBERED_HEADING_LINE = /^(\d+)\.\s+([A-Z][A-Z0-9 ()'".,&/-]*)\s*$/;
const RECITAL_ITEM_START = /^([A-Z])\.\s+(.*)$/;
const BULLET_LINE = /^\s{2,}-\s+(.*)$/;

function isAllCapsLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /[A-Z]/.test(trimmed) && ALL_CAPS_LINE.test(trimmed);
}

type DeedBlock =
  | { kind: "title"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "recitals"; items: { letter: string; text: string }[] }
  | { kind: "section"; number: string; heading: string; paragraph: string; bullets: string[] }
  | { kind: "paragraph"; text: string; emphasis: boolean };

function parseDeedText(deedText: string): DeedBlock[] {
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

function DeedBody({ deedText }: { deedText: string }) {
  const blocks = useMemo(() => parseDeedText(deedText), [deedText]);

  return (
    <div className="space-y-6" style={{ fontFamily: DEED_FONT }}>
      {blocks.map((block, i) => {
        if (block.kind === "title") {
          return (
            <div key={i} className="space-y-1.5 border-b-2 border-double border-accent-300 pb-7 text-center">
              {block.lines.map((line, j) => (
                <p
                  key={j}
                  className={
                    j === 0
                      ? "text-xl font-bold tracking-wide text-primary-900"
                      : "text-sm font-semibold uppercase tracking-widest text-slate-600"
                  }
                >
                  {line}
                </p>
              ))}
            </div>
          );
        }
        if (block.kind === "heading") {
          return (
            <p key={i} className="text-center text-sm font-bold uppercase tracking-[0.2em] text-primary-800">
              {block.text}
            </p>
          );
        }
        if (block.kind === "recitals") {
          return (
            <ol key={i} className="space-y-3">
              {block.items.map((item) => (
                <li key={item.letter} className="flex gap-3 text-[15px] leading-relaxed text-slate-800">
                  <span className="font-semibold text-accent-700">{item.letter}.</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (block.kind === "section") {
          return (
            <div key={i}>
              <h2 className="mb-2 text-[15px] font-bold uppercase tracking-wide text-primary-900">
                <span className="mr-2 text-accent-600">{block.number}.</span>
                {block.heading}
              </h2>
              {block.paragraph && <p className="text-[15px] leading-relaxed text-slate-800">{block.paragraph}</p>}
              {block.bullets.length > 0 && (
                <ul className="mt-2 space-y-1 pl-5">
                  {block.bullets.map((bullet, k) => (
                    <li key={k} className="list-disc text-[15px] leading-relaxed text-slate-800 marker:text-accent-500">
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }
        return (
          <p
            key={i}
            className={`text-[15px] leading-relaxed ${block.emphasis ? "italic text-slate-600" : "text-slate-800"}`}
          >
            {block.text}
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
}: {
  eyebrow: string;
  title: string;
  deedText: string;
  signedBy: string;
  signedAt: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl print:rounded-none print:border-0 print:shadow-none">
      <div className="h-1.5 bg-gradient-to-r from-primary-700 via-accent-500 to-primary-700" aria-hidden="true" />
      <div className="px-6 py-10 sm:px-14 sm:py-14">
        <div className="mb-8 flex flex-col items-center text-center">
          <IconMark className="h-12 w-12" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-accent-700">{eyebrow}</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900" style={{ fontFamily: DEED_FONT }}>
            {title}
          </h1>
        </div>

        <DeedBody deedText={deedText} />

        <div className="mt-12 border-t border-slate-200 pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Signed by</p>
              <p className="mt-1 text-base font-semibold text-slate-900" style={{ fontFamily: DEED_FONT }}>
                {signedBy}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Date</p>
              <p className="mt-1 text-sm text-slate-700">{signedAt}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="h-1.5 bg-gradient-to-r from-primary-700 via-accent-500 to-primary-700" aria-hidden="true" />
    </div>
  );
}
