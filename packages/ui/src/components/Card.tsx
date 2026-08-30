import { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "neutral" | "primary" | "accent" | "violet";
}

// Resolved through a lookup map — same pattern as StatCard — rather than
// a hardcoded `bg-white border-slate-200` base with callers appending a
// tint via `className`. Tailwind has no `tailwind-merge` in this repo,
// so two same-property utility classes (the base `bg-white` and a
// caller's appended `bg-primary-50`) resolve by *generated CSS order*,
// not HTML class-list order — the base was silently winning every time,
// which is why passing tint classes via `className` rendered as plain
// white despite being "correct" markup. A `tone` prop sidesteps the
// conflict entirely: only one background/border utility for the
// property is ever emitted for a given render.
const toneClasses: Record<NonNullable<CardProps["tone"]>, string> = {
  neutral: "border-slate-200 bg-white",
  primary: "border-primary-200 bg-primary-50",
  accent: "border-accent-200 bg-accent-50",
  violet: "border-violet-200 bg-violet-50",
};

export function Card({ tone = "neutral", className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-lg border p-6 shadow-sm ${toneClasses[tone]} ${className}`}
      {...props}
    />
  );
}
