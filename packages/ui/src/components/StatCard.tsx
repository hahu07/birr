import { HTMLAttributes, ReactNode } from "react";

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "violet";
}

// Icon swatch: solid tone color, white glyph — bold enough to anchor the
// tile rather than the pale almost-white tint the previous version used.
const iconClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  // Was bg-slate-200 in a wrapper that also defaulted to bg-white — next
  // to two solid-fill tinted tiles, that combination read as the "off"
  // state of a toggle rather than a tile carrying an equally real count
  // (e.g. Approvals' "Proposed by officers", same count as the AI-agent
  // tile beside it). A darker chip in a visibly tinted shell reads as a
  // third deliberate tone, not a disabled one.
  neutral: "bg-slate-500 text-white",
  primary: "bg-primary-600 text-white",
  success: "bg-primary-600 text-white",
  warning: "bg-accent-600 text-white",
  violet: "bg-violet-600 text-white",
};

// Card shell: a soft tint of the same hue plus a matching border, so
// color carries through the whole tile, not just the icon chip.
const wrapperClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "border-slate-300 bg-slate-100",
  primary: "border-primary-200 bg-primary-50",
  success: "border-primary-200 bg-primary-50",
  warning: "border-accent-200 bg-accent-50",
  violet: "border-violet-200 bg-violet-50",
};

/**
 * Small summary tile for the strip of derived counts above a list view
 * (e.g. active/reassigned/closed cases, pending decisions by maker type).
 * Deliberately plain — a label, a number, and an icon swatch — so a row
 * of these reads as glanceable context, not competing with the table
 * below for attention.
 */
export function StatCard({ label, value, icon, tone = "neutral", className = "", ...props }: StatCardProps) {
  return (
    <div
      className={`flex items-center gap-3.5 rounded-lg border px-4 py-3.5 ${wrapperClasses[tone]} ${className}`}
      {...props}
    >
      {icon && (
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md shadow-sm ${iconClasses[tone]}`}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        {/* break-words — a long unbroken value (e.g. "1,500,000.00", no
            spaces to wrap at) otherwise overflows this tile's width
            instead of wrapping, clipped by the parent grid cell (found
            on a 375px mobile viewport, 2026-09-29 codebase walkthrough). */}
        <p className="break-words text-xl font-semibold leading-tight tracking-tight text-slate-900">{value}</p>
        <p className="text-xs font-medium leading-snug text-slate-500">{label}</p>
      </div>
    </div>
  );
}
