import { HTMLAttributes } from "react";

/** Loading placeholder block — compose into row/card shapes for skeleton states. */
export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} {...props} />;
}
