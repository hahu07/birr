import { IconProps } from "./types";

/** Used for the Ops Console's Staff nav item. */
export function IconUsers({ className = "", ...props }: IconProps) {
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
      <circle cx="9" cy="7.5" r="3" />
      <path d="M2.6 20c0-3.6 2.9-6.5 6.4-6.5s6.4 2.9 6.4 6.5" />
      <path d="M16.2 4.7a3 3 0 0 1 0 5.6" />
      <path d="M21.4 20c0-3.2-2.2-5.9-5.2-6.4" />
    </svg>
  );
}
