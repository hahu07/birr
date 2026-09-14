import { SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** Same base styling as Input, extracted here since a plain
 * `<select className="rounded-md border ...">` with this exact class
 * string was found copy-pasted across the Vault Ops Console (and,
 * beyond this pass's scope, several other forms elsewhere in the app). */
export function Select({ className = "", ...props }: SelectProps) {
  return (
    <select
      className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ${className}`}
      {...props}
    />
  );
}
