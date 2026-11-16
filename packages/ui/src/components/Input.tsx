"use client";

import { ChangeEvent, FocusEvent, InputHTMLAttributes, useEffect, useId, useRef, useState } from "react";
import { FIELD_LIMITS, FieldKind, fieldProblem, phoneCharactersOnly } from "@birr/shared";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** When present: red border, an aria-invalid input, and a role="alert"
   * message rendered below. Omit entirely (not just falsy) to keep an
   * existing call site rendering exactly as it did before this prop
   * existed — the bare <input> path below is unchanged either way. */
  error?: string;
  /**
   * Check the value as the person types (2026-11-16), with the same rules
   * the API applies: "name" needs letters, "reference" needs digits.
   * Phone (type="tel"), email and url inputs are checked without asking.
   * The message shows once they leave the field, and the form can't be
   * submitted while it's wrong.
   */
  check?: FieldKind;
}

/**
 * The most a field takes when a page doesn't say (2026-11-16): the same
 * limits the API enforces, so a form stops at the length the server would
 * accept. A page passes its own maxLength for a field with a different
 * limit (a name, a code).
 */
function defaultMaxLength(type: InputProps["type"], check: FieldKind | undefined): number | undefined {
  if (check === "name") return FIELD_LIMITS.name;
  if (check === "reference") return FIELD_LIMITS.code;
  switch (type) {
    case "email":
      return FIELD_LIMITS.email;
    case "url":
      return FIELD_LIMITS.url;
    case "tel":
      return FIELD_LIMITS.phone;
    case "password":
      return 200; // as PasswordInput
    case undefined:
    case "text":
    case "search":
      return FIELD_LIMITS.text;
    default:
      // Numbers, dates, files, checkboxes: maxLength doesn't apply.
      return undefined;
  }
}

function checkFor(type: InputProps["type"], check: FieldKind | undefined): FieldKind | undefined {
  if (check) return check;
  if (type === "tel") return "phone";
  if (type === "email") return "email";
  if (type === "url") return "url";
  return undefined;
}

export function Input({ className = "", error, id, maxLength, check, onChange, onBlur, onInvalid, ...props }: InputProps) {
  const generatedId = useId();
  const kind = checkFor(props.type, check);
  const ref = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(typeof props.defaultValue === "string" ? props.defaultValue : "");
  const [left, setLeft] = useState(false);
  const value = typeof props.value === "string" ? props.value : typed;
  const problem = kind ? fieldProblem(kind, value) : null;

  // The browser refuses to submit the form while the field is wrong, with
  // the same message.
  useEffect(() => {
    ref.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  const shown = error ?? (left && problem ? problem : undefined);
  const errorId = shown ? `${id ?? generatedId}-error` : undefined;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    if (kind === "phone") {
      const cleaned = phoneCharactersOnly(e.target.value);
      if (cleaned !== e.target.value) e.target.value = cleaned;
    }
    setTyped(e.target.value);
    onChange?.(e);
  }

  const input = (
    <input
      ref={ref}
      id={id}
      className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
        shown
          ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
          : "border-slate-300 focus:border-primary-500 focus:ring-primary-500/20"
      } ${className}`}
      aria-invalid={shown ? true : undefined}
      aria-describedby={errorId}
      maxLength={maxLength ?? defaultMaxLength(props.type, kind)}
      inputMode={kind === "phone" ? "tel" : undefined}
      onChange={handleChange}
      onBlur={(e: FocusEvent<HTMLInputElement>) => {
        setLeft(true);
        onBlur?.(e);
      }}
      onInvalid={(e) => {
        setLeft(true);
        onInvalid?.(e);
      }}
      {...props}
    />
  );

  // A checked field always has its wrapper, so the message appearing or
  // going while someone types never remounts the input (and loses focus).
  if (!shown && !kind) return input;

  return (
    <div>
      {input}
      {shown && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
          {shown}
        </p>
      )}
    </div>
  );
}
