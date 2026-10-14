import { SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** Same base styling as Input, extracted here since a plain
 * `<select className="rounded-md border ...">` with this exact class
 * string was found copy-pasted across the Vault Ops Console (and,
 * beyond this pass's scope, several other forms elsewhere in the app). */
export function Select({ className = "", ...props }: SelectProps) {
  return (
    <select
      className={`rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${className}`}
      {...props}
    />
  );
}
