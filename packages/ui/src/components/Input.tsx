"use client";

import { InputHTMLAttributes, useId } from "react";
import { FIELD_LIMITS } from "@birr/shared";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** When present: red border, an aria-invalid input, and a role="alert"
   * message rendered below. Omit entirely (not just falsy) to keep an
   * existing call site rendering exactly as it did before this prop
   * existed — the bare <input> path below is unchanged either way. */
  error?: string;
}

/**
 * The most a field takes when a page doesn't say (2026-11-16): the same
 * limits the API enforces, so a form stops at the length the server would
 * accept. A page passes its own maxLength for a field with a different
 * limit (a name, a code).
 */
function defaultMaxLength(type: InputProps["type"]): number | undefined {
  switch (type) {
    case "email":
      return FIELD_LIMITS.email;
    case "url":
      return FIELD_LIMITS.url;
    case "password":
      return 200; // as PasswordInput
    case undefined:
    case "text":
    case "search":
    case "tel":
      return FIELD_LIMITS.text;
    default:
      // Numbers, dates, files, checkboxes: maxLength doesn't apply.
      return undefined;
  }
}

export function Input({ className = "", error, id, maxLength, ...props }: InputProps) {
  const generatedId = useId();
  const errorId = error ? `${id ?? generatedId}-error` : undefined;
  const input = (
    <input
      id={id}
      className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
        error
          ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
          : "border-slate-300 focus:border-primary-500 focus:ring-primary-500/20"
      } ${className}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      maxLength={maxLength ?? defaultMaxLength(props.type)}
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
