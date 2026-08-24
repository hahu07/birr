import { IconProps } from "./types";

/** Tray-with-slot mark used for the Caseload nav item. */
export function IconInbox({ className = "", ...props }: IconProps) {
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
      <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v4.5l-2.6 6a1 1 0 0 1-.92.6H6.52a1 1 0 0 1-.92-.6L3 9.5V5Z" />
      <path d="M3 9.5h5.3l1 2h5.4l1-2H21" />
    </svg>
  );
}
