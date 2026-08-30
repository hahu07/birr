import { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  // A confident two-stop gradient rather than a flat fill — both stops
  // (600→700) individually clear WCAG AA for white text, so the richer
  // look never risks legibility.
  primary:
    "bg-gradient-to-b from-primary-600 to-primary-700 text-white shadow-sm shadow-primary-900/25 hover:from-primary-700 hover:to-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
  secondary:
    "bg-white text-primary-700 border border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
  // For consequential-but-not-destructive negative actions (e.g. rejecting
  // a governed action) — distinct from `secondary`'s neutral-teal styling
  // so Approve/Reject read as two different weights of decision, not two
  // visually identical buttons with different labels.
  danger:
    "bg-white text-red-600 border border-red-200 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
