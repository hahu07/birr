// Founder Portal form building blocks (2026-10 redesign) — numbered
// sections, labelled fields, card-style radio choices and a currency-
// prefixed money input, shared by the Waqf Fund, Foundation and
// onboarding forms so every self-service form reads the same way.
import { InputHTMLAttributes, ReactNode } from "react";
import { formatMoney } from "../../../lib/format";

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 read-only:bg-slate-50 read-only:text-slate-600";

export function FormSection({ step, title, description, children }: { step?: number; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        {step !== undefined && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-800 text-xs font-bold text-white">{step}</span>
        )}
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Field({ label, htmlFor, hint, optional, children }: { label: string; htmlFor: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-800">
        {label} {optional && <span className="font-normal text-slate-500">(optional)</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * A plain number input with the currency symbol as a prefix and the
 * typed amount echoed back formatted ("₦1,500,000") — long naira figures
 * are easy to mistype by a zero in a bare number box.
 */
export function MoneyInput({ currency, value, ...props }: InputHTMLAttributes<HTMLInputElement> & { currency: string; value: string }) {
  const symbol = formatMoney(0, currency, { decimals: 0 }).replace(/[\d.,\s]/g, "") || currency;
  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-semibold text-slate-500">{symbol}</span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          {...props}
          className={`${inputClass} tabular-nums ${symbol.length > 1 ? "pl-14" : "pl-8"}`}
        />
      </div>
      {Number(value) > 0 && <p className="mt-1 text-xs font-medium tabular-nums text-primary-700">{formatMoney(value, currency)}</p>}
    </div>
  );
}

export function ChoiceCard({
  name,
  checked,
  onChange,
  title,
  body,
  disabled,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`relative flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500/40 ${
        checked ? "border-primary-500 bg-primary-50/70 ring-1 ring-primary-500" : "border-slate-200 bg-white hover:border-slate-300"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700" />
      <span>
        <span className={`block text-sm font-semibold ${checked ? "text-primary-900" : "text-slate-900"}`}>{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{body}</span>
      </span>
    </label>
  );
}
