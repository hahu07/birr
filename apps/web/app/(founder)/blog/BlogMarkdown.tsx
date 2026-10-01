// Renders the small Markdown subset blog articles use — ## / ### headings,
// paragraphs, - and 1. lists, **bold**, *italic*, [links](url) — into plain
// React elements. No raw HTML is ever injected: content is repo-authored,
// but rendering through React nodes (and allow-listing link schemes) means
// a bad paste can't become a script tag. Deliberately not a full Markdown
// engine; add syntax here only when an article genuinely needs it.
//
// Two teaching aids beyond plain prose, because a concrete case sticks in
// a reader's mind where an abstract definition doesn't:
//   :::example Title        a highlighted worked example (any Markdown
//   ...                     inside it), closed by a line of just :::
//   :::
//   | A | B |               a table (header row, a |---|---| separator
//   |---|---|               row, then data rows)
//   | 1 | 2 |
import Link from "next/link";
import { ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      const safe = href.startsWith("/") || /^(https?:|mailto:)/.test(href);
      if (!safe) return label;
      const cls = "font-medium text-primary-700 underline hover:text-primary-800";
      return href.startsWith("/") ? (
        <Link key={i} href={href} className={cls}>
          {label}
        </Link>
      ) : (
        <a key={i} href={href} className={cls} rel="noopener noreferrer">
          {label}
        </a>
      );
    }
    return part;
  });
}

const isTableRow = (l: string) => l.trimStart().startsWith("|") && l.trimEnd().endsWith("|");
const splitRow = (l: string) =>
  l
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());

type Segment = { kind: "text"; text: string } | { kind: "example"; title: string; text: string };

/** Splits out :::example ... ::: containers; everything else stays plain text. */
function splitSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  let text: string[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^:::example(?:\s+(.*))?$/.exec(lines[i].trim());
    if (!open) {
      text.push(lines[i]);
      continue;
    }
    const inner: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() !== ":::") inner.push(lines[i++]);
    if (text.length) segments.push({ kind: "text", text: text.join("\n") });
    text = [];
    segments.push({ kind: "example", title: open[1]?.trim() || "Example", text: inner.join("\n") });
  }
  if (text.length) segments.push({ kind: "text", text: text.join("\n") });
  return segments;
}

export function BlogMarkdown({ source }: { source: string }) {
  return (
    <div className="space-y-5 text-base leading-relaxed text-slate-700">
      {splitSegments(source).map((seg, i) =>
        seg.kind === "example" ? (
          <aside key={i} className="rounded-2xl border border-accent-200 bg-accent-50/70 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent-700">Example</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{seg.title}</p>
            <div className="mt-4">
              <BlogMarkdown source={seg.text} />
            </div>
          </aside>
        ) : (
          <TextBlocks key={i} source={seg.text} />
        ),
      )}
    </div>
  );
}

function TextBlocks({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.length >= 3 && lines.every(isTableRow) && /^\|[\s:|-]+\|$/.test(lines[1].trim())) {
          const head = splitRow(lines[0]);
          return (
            <div key={i} className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-slate-900">
                  <tr>
                    {head.map((h, j) => (
                      <th key={j} className="px-4 py-3 font-semibold">
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.slice(2).map((row, r) => (
                    <tr key={r} className="border-t border-slate-100 align-top">
                      {splitRow(row).map((c, j) => (
                        <td key={j} className={`px-4 py-3 ${j === 0 ? "font-medium text-slate-900" : ""}`}>
                          {renderInline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.startsWith("### ")) {
          return (
            <h3 key={i} className="pt-2 text-lg font-semibold tracking-tight text-slate-900">
              {renderInline(block.slice(4))}
            </h3>
          );
        }
        if (block.startsWith("## ")) {
          return (
            <h2 key={i} className="pt-4 text-2xl font-semibold tracking-tight text-slate-900">
              {renderInline(block.slice(3))}
            </h2>
          );
        }
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="list-disc space-y-2 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\. /.test(l))) {
          return (
            <ol key={i} className="list-decimal space-y-2 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\d+\. /, ""))}</li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{renderInline(lines.join(" "))}</p>;
      })}
    </>
  );
}
