import { IconProps } from "./types";

export function IconEyeOff({ className = "", ...props }: IconProps) {
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
      <path d="M9.9 5.2A9.9 9.9 0 0 1 12 5c6 0 9.5 7 9.5 7a17.4 17.4 0 0 1-2.7 3.6M6.4 6.4C4 8 2.5 12 2.5 12s3.5 7 9.5 7a9.7 9.7 0 0 0 4.6-1.1M9.9 14.1a3 3 0 0 0 4.2-4.2" />
      <path d="M2.5 2.5l19 19" />
    </svg>
  );
}
