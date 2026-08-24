import { IconProps } from "./types";

/** Used for reassigned-case counts. */
export function IconRepeat({ className = "", ...props }: IconProps) {
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
      <path d="M4 7.5h11a4 4 0 0 1 4 4v1" />
      <path d="M17.2 4.3l2.8 3.2-2.8 3.2" />
      <path d="M20 16.5H9a4 4 0 0 1-4-4v-1" />
      <path d="M6.8 19.7L4 16.5l2.8-3.2" />
    </svg>
  );
}
