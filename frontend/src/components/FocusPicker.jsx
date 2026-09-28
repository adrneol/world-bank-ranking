/**
 * Focus-country picker (Phase 6: accessible combobox).
 *
 * Same props contract as the Phase-1 picker; the interaction is now the
 * shared SearchableSelect (type to filter, arrows/Enter/Escape, visible
 * focus, click-outside, viewport-anchored popover). The backend/database
 * remains authoritative for country names — nothing is hard-coded here.
 * Focus stays country-only; aggregates and groups belong to Compare.
 */

import { useMemo } from 'react';
import { SearchableSelect } from './controls.jsx';
import { Field } from './ui.jsx';

export default function FocusPicker({ countries, value = 'IND', onChange, id = 'f-country' }) {
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

  return (
    <SearchableSelect
      id={id}
      label="Focus country"
      value={value}
      placeholder="Select a country…"
      options={list.map((c) => ({ value: c.iso3, label: `${c.name} (${c.iso3})` }))}
      onChange={onChange}
    />
  );
}
