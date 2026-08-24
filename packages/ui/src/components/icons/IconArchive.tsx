import { IconProps } from "./types";

/** Used for closed-case counts. */
export function IconArchive({ className = "", ...props }: IconProps) {
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
      <rect x="3.25" y="4" width="17.5" height="4" rx="1" />
      <path d="M4.75 8v9.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V8" />
      <path d="M10 12.5h4" />
    </svg>
  );
}
