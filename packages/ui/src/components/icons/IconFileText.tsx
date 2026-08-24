import { IconProps } from "./types";

/** Used for the Ops Console's Audit Log nav item. */
export function IconFileText({ className = "", ...props }: IconProps) {
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
      <path d="M14 3H6.8A1.8 1.8 0 0 0 5 4.8v14.4A1.8 1.8 0 0 0 6.8 21h10.4a1.8 1.8 0 0 0 1.8-1.8V8Z" />
      <path d="M14 3v4.2A1.8 1.8 0 0 0 15.8 9H19" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16.5h7" />
      <path d="M8.5 9.5h2.5" />
    </svg>
  );
}
