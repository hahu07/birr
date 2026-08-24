import { IconProps } from "./types";

/** Sign-out mark used at the base of the sidebar. */
export function IconLogOut({ className = "", ...props }: IconProps) {
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
      <path d="M9.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3.5" />
      <path d="M15 16l4-4-4-4" />
      <path d="M19 12H9.5" />
    </svg>
  );
}
