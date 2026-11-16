"use client";

// The one way to enter a jurisdiction (owner's decision, 2026-11-16): a
// searchable list of countries ("Nigeria (NG)"; type a name or a code),
// storing the two-letter ISO code the API requires, so a Waqf Fund, its
// compliance policy and Birr's trustee licence always match.
import { useMemo } from "react";
import { COUNTRIES, countryLabel } from "@birr/shared";
import { Combobox } from "@birr/ui";

export function CountrySelect({
  id,
  value,
  onChange,
  placeholder = "Choose a country…",
  disabled,
  className,
}: {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const options = useMemo(() => COUNTRIES.map((c) => ({ value: c.code, label: countryLabel(c.code) })), []);
  return <Combobox id={id} options={options} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} className={className} />;
}
