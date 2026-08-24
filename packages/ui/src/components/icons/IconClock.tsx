import { IconProps } from "./types";

/** Used for time-sensitive counts — e.g. actions awaiting a decision. */
export function IconClock({ className = "", ...props }: IconProps) {
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
      <path d="M12 7.2V12l3.3 2" />
    </svg>
  );
}
