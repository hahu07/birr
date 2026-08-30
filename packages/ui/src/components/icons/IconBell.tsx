import { IconProps } from "./types";

/** Notification bell — used for the in-app notification tray trigger. */
export function IconBell({ className = "", ...props }: IconProps) {
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
      <path d="M6 10a6 6 0 0 1 12 0c0 3.2 1 5 1.8 6.2a1 1 0 0 1-.8 1.6H5a1 1 0 0 1-.8-1.6C5 15 6 13.2 6 10Z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
