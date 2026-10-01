// Renders the small Markdown subset blog articles use — ## / ### headings,
// paragraphs, - and 1. lists, **bold**, *italic*, [links](url) — into plain
// React elements. No raw HTML is ever injected: content is repo-authored,
// but rendering through React nodes (and allow-listing link schemes) means
// a bad paste can't become a script tag. Deliberately not a full Markdown
// engine; add syntax here only when an article genuinely needs it.
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

export function BlogMarkdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/);
  return (
    <div className="space-y-5 text-base leading-relaxed text-slate-700">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
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
    </div>
  );
}
