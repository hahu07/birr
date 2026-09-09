"use client";

import { InputHTMLAttributes, useId } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** When present: red border, an aria-invalid input, and a role="alert"
   * message rendered below. Omit entirely (not just falsy) to keep an
   * existing call site rendering exactly as it did before this prop
   * existed — the bare <input> path below is unchanged either way. */
  error?: string;
}

export function Input({ className = "", error, id, ...props }: InputProps) {
  const generatedId = useId();
  const errorId = error ? `${id ?? generatedId}-error` : undefined;
  const input = (
    <input
      id={id}
      className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 ${
        error
          ? "border-red-300 focus:border-red-500 focus:ring-red-500"
          : "border-slate-300 focus:border-primary-500 focus:ring-primary-500"
      } ${className}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      {...props}
    />
  );

  if (!error) return input;

  return (
    <div>
      {input}
      <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
        {error}
      </p>
    </div>
  );
}
