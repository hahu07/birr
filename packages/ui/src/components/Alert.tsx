import { HTMLAttributes, ReactNode } from "react";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  title?: string;
  children?: ReactNode;
}

const toneClasses: Record<NonNullable<AlertProps["tone"]>, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-primary-200 bg-primary-50 text-primary-800",
  warning: "border-accent-300 bg-accent-50 text-accent-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-violet-200 bg-violet-50 text-violet-800",
};

/** Banner/inline alert — used for fetch errors and decision failures that need to stay attached to context, not a toast. */
export function Alert({ tone = "neutral", title, className = "", children, ...props }: AlertProps) {
  // A screen-reader user gets nothing when this mounts or updates
  // unless it's announced explicitly — `role="alert"` on danger (an
  // implicit assertive live region) so a failed submission interrupts,
  // `aria-live="polite"` everywhere else so success/info banners are
  // announced without cutting off whatever's being read. Callers can
  // still override either via props, since they're spread last.
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      aria-live={tone === "danger" ? undefined : "polite"}
      className={`rounded-md border px-4 py-3 text-sm ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}
