"use client";

import { useState } from "react";
import { Input, InputProps } from "./Input";
import { IconEye, IconEyeOff } from "./icons";

/** The longest password the API accepts (2026-11-16). */
const PASSWORD_MAX_LENGTH = 200;

export function PasswordInput({
  className = "",
  maxLength = PASSWORD_MAX_LENGTH,
  ...props
}: Omit<InputProps, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={`pr-10 ${className}`} maxLength={maxLength} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-600"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
      </button>
    </div>
  );
}
