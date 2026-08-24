import { IconProps } from "./types";

/** Used for active-case counts and inline "approved" confirmation. */
export function IconCheckCircle({ className = "", ...props }: IconProps) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M8.3 12.3l2.3 2.3 5-5.2" />
    </svg>
  );
}
