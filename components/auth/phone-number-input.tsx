"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ChevronDown } from "lucide-react";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

const countries = getCountries()
  .map((country) => ({
    country,
    callingCode: getCountryCallingCode(country),
  }))
  // Keep labels locale-independent so server and browser ICU versions
  // produce identical option text during hydration.
  .sort((a, b) => a.country.localeCompare(b.country));

interface PhoneNumberInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PhoneNumberInput({
  id,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
}: PhoneNumberInputProps) {
  const [country, setCountry] = useState<CountryCode>("IN");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const countryPickerRef = useRef<HTMLDivElement>(null);
  const parsed = value ? parsePhoneNumberFromString(value) : undefined;
  const selectedCountry = parsed?.country ?? country;
  const callingCode = getCountryCallingCode(selectedCountry);
  const prefix = `+${callingCode}`;
  const nationalNumber = value.startsWith(prefix)
    ? value.slice(prefix.length)
    : parsed?.nationalNumber ?? "";
  const filteredCountries = countries.filter(({ country: countryCode, callingCode: code }) =>
    countryCode.toLowerCase().includes(countrySearch.trim().toLowerCase()) ||
    `+${code}`.includes(countrySearch.trim()),
  );

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!countryPickerRef.current?.contains(event.target as Node)) {
        setCountryMenuOpen(false);
        setCountrySearch("");
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function handleNumberChange(event: ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/\D/g, "");
    if (!digits) {
      onChange("");
      return;
    }
    const parsedNumber = parsePhoneNumberFromString(digits, selectedCountry);
    onChange(parsedNumber?.number ?? `${prefix}${digits}`);
  }

  function handleCountryChange(nextCountry: CountryCode) {
    setCountry(nextCountry);
    if (!nationalNumber) {
      onChange("");
      return;
    }
    const parsedNumber = parsePhoneNumberFromString(nationalNumber, nextCountry);
    onChange(
      parsedNumber?.number ?? `+${getCountryCallingCode(nextCountry)}${nationalNumber}`,
    );
    setCountryMenuOpen(false);
    setCountrySearch("");
  }

  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
      <div className="relative" ref={countryPickerRef}>
        <button
          type="button"
          onClick={() => setCountryMenuOpen((open) => !open)}
          disabled={disabled}
          aria-label={`Country calling code ${prefix}`}
          aria-haspopup="listbox"
          aria-expanded={countryMenuOpen}
          className="flex min-h-12 w-full items-center justify-between rounded-xl border bg-[var(--color-bg-primary)] px-3 text-base text-[var(--color-fg-primary)] outline-none focus:border-[var(--color-accent)] focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          <span>{prefix}</span>
          <ChevronDown size={15} className="shrink-0 text-[var(--color-fg-muted)]" aria-hidden />
        </button>
        {countryMenuOpen && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-64 overflow-hidden rounded-xl border bg-[var(--color-bg-primary)] p-2 shadow-xl" style={{ borderColor: "var(--color-border-default)" }}>
            <input
              type="search"
              value={countrySearch}
              onChange={(event) => setCountrySearch(event.target.value)}
              placeholder="Search country or code"
              aria-label="Search countries and calling codes"
              className="mb-2 min-h-10 w-full rounded-lg border bg-[var(--color-bg-secondary)] px-3 text-sm text-[var(--color-fg-primary)] outline-none focus:border-[var(--color-accent)]"
              style={{ borderColor: "var(--color-border-default)" }}
              autoFocus
            />
            <div role="listbox" aria-label="Country calling codes" className="max-h-56 overflow-y-auto">
              {filteredCountries.map(({ country: countryCode, callingCode: code }) => (
                <button
                  key={countryCode}
                  type="button"
                  role="option"
                  aria-selected={countryCode === selectedCountry}
                  onClick={() => handleCountryChange(countryCode)}
                  className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)] aria-selected:bg-[var(--color-bg-tertiary)]"
                >
                  <span>{countryCode}</span>
                  <span className="text-[var(--color-fg-secondary)]">+{code}</span>
                </button>
              ))}
              {filteredCountries.length === 0 && (
                <p className="px-3 py-2 text-sm text-[var(--color-fg-muted)]">No matching country</p>
              )}
            </div>
          </div>
        )}
      </div>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        value={nationalNumber}
        onChange={handleNumberChange}
        disabled={disabled}
        required
        aria-label="Phone number"
        placeholder="Phone number"
        className="min-h-12 min-w-0 rounded-xl border bg-[var(--color-bg-primary)] px-3 text-base text-[var(--color-fg-primary)] outline-none focus:border-[var(--color-accent)] focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60"
        style={{ borderColor: "var(--color-border-default)" }}
      />
    </div>
  );
}
