import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown } from "./icons";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** Selected option's value — "" for no selection. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown in the dropdown while the option list itself is still loading. */
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * A searchable single-select — the first of its kind in this codebase
 * (every other dropdown here is a plain native `<select>`, fine for a
 * handful of options but unusable once a list runs into the dozens,
 * e.g. every Nigerian bank). No headless-UI/Radix dependency installed
 * anywhere in this repo, so this is hand-rolled to match that existing
 * bias (see the Paystack adapters' own comment on hand-rolled fetch
 * over an SDK) — plain state + a click-outside listener, same pattern
 * NotificationBell already uses, not a new convention.
 *
 * The displayed text and the committed selection are deliberately two
 * different pieces of state: typing to search must not overwrite the
 * real selection until an option is actually picked, and blurring
 * without picking one reverts the visible text back to whatever's
 * still selected (or empty) rather than leaving a half-typed query
 * behind.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search…",
  loading = false,
  disabled = false,
  className = "",
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  function selectOption(option: ComboboxOption) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[highlighted];
      if (option) selectOption(option);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          value={open ? query : (selected?.label ?? "")}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        />
        <IconChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {loading ? (
            <li className="px-3 py-2 text-sm text-slate-400">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">No matches.</li>
          ) : (
            filtered.map((option, i) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                // onMouseDown, not onClick — fires before the input's
                // onBlur/click-outside handler, so selecting an option
                // doesn't race the dropdown closing out from under it.
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(option);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  i === highlighted ? "bg-primary-50 text-primary-900" : "text-slate-700"
                } ${option.value === value ? "font-medium" : ""}`}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
