import { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-primary-600 text-white hover:bg-primary-700",
  secondary:
    "bg-white text-primary-700 border border-primary-300 hover:bg-primary-50",
  // For consequential-but-not-destructive negative actions (e.g. rejecting
  // a governed action) — distinct from `secondary`'s neutral-teal styling
  // so Approve/Reject read as two different weights of decision, not two
  // visually identical buttons with different labels.
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
