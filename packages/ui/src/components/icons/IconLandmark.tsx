import { IconProps } from "./types";

/** Used for Foundation nav/pages — an institutional building glyph. */
export function IconLandmark({ className = "", ...props }: IconProps) {
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
      <path d="M3 21h18" />
      <path d="M4.5 21v-8.5M9 21v-8.5M15 21v-8.5M19.5 21v-8.5" />
      <path d="M2.5 12.5 12 4l9.5 8.5Z" />
    </svg>
  );
}
