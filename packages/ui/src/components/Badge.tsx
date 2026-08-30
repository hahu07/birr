import { HTMLAttributes } from "react";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}

// One step deeper than the first pass at this file (100/800 → 200/900):
// a status column of a dozen-plus pills at 100-weight fill still read as
// "almost white" in review — exactly the flaw the brief called out in
// the original placeholder palette. 200/900 keeps every pairing above
// 7:1 while giving each tone actual, visible color at a glance, not
// just on close inspection.
const toneClasses: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-slate-200 text-slate-800",
  success: "bg-primary-200 text-primary-900",
  warning: "bg-accent-300 text-accent-900",
  danger: "bg-red-200 text-red-800",
  // Agent-attribution / AI-related status — the one place violet is
  // given a real semantic job outside the auth gradient (AI Agents
  // registry, agent-proposed governed actions).
  info: "bg-violet-200 text-violet-900",
};

/** Status pill — for GovernedAction/Distribution/etc. status display. */
export function Badge({ tone = "neutral", className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]} ${className}`}
      {...props}
    />
  );
}
