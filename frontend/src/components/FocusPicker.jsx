/**
 * Focus-country picker (Phase 1: generic focus abstraction).
 *
 * A deliberately basic searchable picker built from existing UI patterns
 * (Field + native controls, no new framework): a search box filters the
 * eligible-country list served by GET /api/countries, and a native select
 * commits the selection. The backend/database remains authoritative for
 * country names — nothing is hard-coded here.
 *
 * Custom groups, aggregates and regions are out of scope until Phase 4:
 * only eligible countries are listed.
 */

import { useMemo, useState } from 'react';
import { Field } from './ui.jsx';

export default function FocusPicker({ countries, value = 'IND', onChange, id = 'f-country' }) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => countries ?? [], [countries]);

  // No country metadata yet (loading or failed): fall back to a plain ISO3
  // field so focus selection never blocks on the picker list. The backend
  // validates the code and fails closed with 400 INVALID_COUNTRY.
  if (list.length === 0) {
    return (
      <Field label="Focus country" htmlFor={id} hint="ISO3 code (e.g. IND)">
        <input
          id={id}
          value={value}
          maxLength={3}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </Field>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = (
    q
      ? list.filter(
          (c) =>
            String(c.name ?? '').toLowerCase().includes(q) || String(c.iso3 ?? '').toLowerCase().includes(q),
        )
      : list
  ).slice(0, 300);
  const selected = list.find((c) => c.iso3 === value) ?? null;
  const options = selected && !filtered.some((c) => c.iso3 === selected.iso3) ? [selected, ...filtered] : filtered;

  return (
    <Field label="Focus country" htmlFor={id}>
      <span className="search-row">
        <input
          type="search"
          value={query}
          placeholder="Search countries…"
          aria-label="Search focus countries"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-label="Focus country">
          {options.map((c) => (
            <option key={c.iso3} value={c.iso3}>
              {c.name} ({c.iso3})
            </option>
          ))}
        </select>
      </span>
    </Field>
  );
}
