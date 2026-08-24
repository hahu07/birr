import { IconProps } from "./types";

/** Used for counts of actions proposed by human Birr officers. */
export function IconUser({ className = "", ...props }: IconProps) {
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
      <circle cx="12" cy="8.2" r="3.3" />
      <path d="M4.8 20c0-4 3.2-7.2 7.2-7.2s7.2 3.2 7.2 7.2" />
    </svg>
  );
}
