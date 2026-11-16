"use client";

import { useEffect, useRef } from "react";

export const CODE_LENGTH = 6;

/**
 * Six single-digit boxes that behave as one field: typing moves to the
 * next box, Backspace on an empty box moves back, and pasting a whole
 * code (from WhatsApp, or the phone's own one-time-code suggestion)
 * fills every box at once.
 */
export function OtpInput({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  // The code has no gaps: a digit typed past the end goes in the next
  // empty box. One digit replaces just that box, keeping the rest; several
  // (a paste, or the phone's autofill) fill from that box onwards.
  function setFrom(index: number, typed: string) {
    const digits = typed.replace(/\D/g, "");
    if (!digits) return;
    const at = Math.min(index, value.length);
    const next = (digits.length === 1 ? value.slice(0, at) + digits + value.slice(at + 1) : value.slice(0, at) + digits).slice(0, CODE_LENGTH);
    onChange(next);
    inputs.current[Math.min(at + digits.length, CODE_LENGTH - 1)]?.focus();
  }

  return (
    <fieldset>
      <legend className="mb-3 block w-full text-center text-sm font-medium text-slate-700">6-digit code</legend>
      <div className="flex justify-center gap-2 sm:gap-3">
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1}`}
            maxLength={i === 0 ? CODE_LENGTH : 1}
            value={value[i] ?? ""}
            disabled={disabled}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setFrom(i, e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              setFrom(0, e.clipboardData.getData("text"));
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                e.preventDefault();
                // Removes one digit; the ones after it stay.
                if (value[i]) onChange(value.slice(0, i) + value.slice(i + 1));
                else if (i > 0) {
                  onChange(value.slice(0, i - 1) + value.slice(i));
                  inputs.current[i - 1]?.focus();
                }
              } else if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
              else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) inputs.current[i + 1]?.focus();
            }}
            className={`h-12 w-11 rounded-lg border bg-white text-center text-xl font-semibold text-slate-900 tabular-nums shadow-sm transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 sm:h-14 sm:w-12 ${
              invalid ? "border-red-300 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-primary-500 focus:ring-primary-100"
            }`}
          />
        ))}
      </div>
    </fieldset>
  );
}
