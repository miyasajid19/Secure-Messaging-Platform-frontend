"use client";

import { useState, type ChangeEvent } from "react";
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
  const parsed = value ? parsePhoneNumberFromString(value) : undefined;
  const selectedCountry = parsed?.country ?? country;
  const callingCode = getCountryCallingCode(selectedCountry);
  const prefix = `+${callingCode}`;
  const nationalNumber = value.startsWith(prefix)
    ? value.slice(prefix.length)
    : parsed?.nationalNumber ?? "";

  function handleNumberChange(event: ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/\D/g, "");
    if (!digits) {
      onChange("");
      return;
    }
    const parsedNumber = parsePhoneNumberFromString(digits, selectedCountry);
    onChange(parsedNumber?.number ?? `${prefix}${digits}`);
  }

  function handleCountryChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCountry = event.target.value as CountryCode;
    setCountry(nextCountry);
    if (!nationalNumber) {
      onChange("");
      return;
    }
    const parsedNumber = parsePhoneNumberFromString(nationalNumber, nextCountry);
    onChange(
      parsedNumber?.number ?? `+${getCountryCallingCode(nextCountry)}${nationalNumber}`,
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2">
      <select
        value={selectedCountry}
        onChange={handleCountryChange}
        disabled={disabled}
        aria-label="Country or region code"
        className="min-h-12 min-w-0 rounded-xl border bg-[var(--color-bg-primary)] px-2 text-sm text-[var(--color-fg-primary)] outline-none focus:border-[var(--color-accent)] focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60 sm:px-3"
        style={{ borderColor: "var(--color-border-default)" }}
      >
        {countries.map(({ country: countryCode, callingCode: code }) => (
          <option key={countryCode} value={countryCode}>
            {countryCode} (+{code})
          </option>
        ))}
      </select>
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
