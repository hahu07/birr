import { IconProps } from "./types";

/** Clipboard-with-check mark used for the Approval Queue nav item. */
export function IconClipboardCheck({ className = "", ...props }: IconProps) {
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
      <rect x="5.5" y="4" width="13" height="17" rx="2" />
      <path d="M9 4V3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3.5V4" />
      <path d="M8.7 12.6l2.1 2.1L15.3 10" />
    </svg>
  );
}
