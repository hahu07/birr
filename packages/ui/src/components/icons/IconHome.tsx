import { IconProps } from "./types";

/** Simple dwelling glyph used for the Founder Portal's "Overview" nav item. */
export function IconHome({ className = "", ...props }: IconProps) {
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
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v8.5a1 1 0 0 0 1 1h3.5v-5.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v5.5H17a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
