import { IconProps } from "./types";

/** Roles & access reference. */
export function IconKey({ className = "", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="7.5" cy="7.5" r="4" />
      <path d="M10.5 10.5 20 20" />
      <path d="M15.3 15.3v3.2" />
      <path d="M18 18v2.6" />
    </svg>
  );
}
