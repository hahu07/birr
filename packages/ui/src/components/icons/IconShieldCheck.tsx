import { IconProps } from "./types";

/** Used for the Ops Console's Conflicts of Interest nav item. */
export function IconShieldCheck({ className = "", ...props }: IconProps) {
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
      <path d="M12 3 4.5 5.5v5.6c0 4.6 3.1 8.4 7.5 9.4 4.4-1 7.5-4.8 7.5-9.4V5.5Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
