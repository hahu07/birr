import { HTMLAttributes, ReactNode } from "react";

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning";
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "bg-slate-100 text-slate-500",
  primary: "bg-primary-50 text-primary-700",
  success: "bg-primary-50 text-primary-700",
  warning: "bg-accent-100 text-accent-600",
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
      className={`flex items-center gap-3.5 rounded-lg border border-slate-200 bg-white px-4 py-3.5 ${className}`}
      {...props}
    >
      {icon && (
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneClasses[tone]}`}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-tight tracking-tight text-slate-900">{value}</p>
        <p className="text-xs font-medium leading-snug text-slate-500">{label}</p>
      </div>
    </div>
  );
}
