/**
 * Entity picker for the Compare workspace (Phase 6).
 *
 * One structured control for the three backend entity kinds — no hard-coded
 * region lists anywhere. Countries and official aggregates resolve names
 * from backend metadata; custom groups are request-defined member lists
 * (add/remove/search/clear, never persisted, never called a region).
 * Emits plain entity objects; entityToSpec() renders the API wire form.
 */

import { useMemo, useState } from 'react';
import { SearchableSelect } from './controls.jsx';
import { Field } from './ui.jsx';

const KIND_TABS = [
  { id: 'country', label: 'Country' },
  { id: 'wb_aggregate', label: 'Aggregate' },
  { id: 'custom_group', label: 'Group' },
];

function GroupBuilder({ countries, value, onChange, id }) {
  const [query, setQuery] = useState('');
  const members = value?.members ?? [];
  const memberSet = useMemo(() => new Set(value?.members ?? []), [value]);
  const q = query.trim().toLowerCase();
  const candidates = useMemo(
    () =>
      (countries ?? [])
        .filter((c) => !memberSet.has(c.iso3))
        .filter(
          (c) =>
            !q ||
            String(c.name ?? '').toLowerCase().includes(q) ||
            String(c.iso3 ?? '').toLowerCase().includes(q),
        )
        .slice(0, 60),
    [countries, memberSet, q],
  );

  function add(iso3) {
    onChange({ kind: 'custom_group', members: [...members, iso3], label: value?.label ?? null });
  }
  function remove(iso3) {
    onChange({ kind: 'custom_group', members: members.filter((m) => m !== iso3), label: value?.label ?? null });
  }

  return (
    <div className="group-builder">
      {members.length > 0 ? (
        <ul className="chip-list" aria-label="Selected group members">
          {members.map((iso3) => {
            const name = countries.find((c) => c.iso3 === iso3)?.name ?? iso3;
            return (
              <li key={iso3} className="chip">
                <span>
                  {name} <span className="mono muted">{iso3}</span>
                </span>
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`Remove ${name} from group`}
                  onClick={() => remove(iso3)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No members yet — search below and add economies.</p>
      )}
      <div className="group-add-row">
        <input
          type="search"
          value={query}
          placeholder="Search economies to add…"
          aria-label="Search economies to add to the group"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        {members.length > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => onChange({ kind: 'custom_group', members: [], label: value?.label ?? null })}>
            Clear
          </button>
        ) : null}
      </div>
      {q ? (
        candidates.length > 0 ? (
          <ul className="candidate-list" aria-label="Matching economies">
            {candidates.map((c) => (
              <li key={c.iso3}>
                <button type="button" className="candidate-add" onClick={() => add(c.iso3)}>
                  <span>
                    {c.name} <span className="mono muted">{c.iso3}</span>
                  </span>
                  <span aria-hidden="true">+</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No matching economies.</p>
        )
      ) : null}
      <p className="footnote" id={`${id}-group-note`}>
        User-selected group — never an official region. Members: {members.length}.
      </p>
    </div>
  );
}

export default function EntityPicker({ id, label, value, countries = [], aggregates = [], allowGroups = true, onChange }) {
  const kind = value?.kind ?? 'country';
  const tabs = allowGroups ? KIND_TABS : KIND_TABS.filter((t) => t.id !== 'custom_group');

  function selectKind(nextKind) {
    if (nextKind === 'country') {
      const first = countries[0];
      onChange(first ? { kind: 'country', iso3: first.iso3 } : null);
    } else if (nextKind === 'wb_aggregate') {
      const first = aggregates[0];
      onChange(first ? { kind: 'wb_aggregate', iso3: first.iso3 } : null);
    } else {
      onChange({ kind: 'custom_group', members: [], label: null });
    }
  }

  return (
    <div className="entity-picker">
      <div className="segmented" role="tablist" aria-label={`${typeof label === 'string' ? label : 'Entity'} type`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={kind === tab.id}
            className={kind === tab.id ? 'segmented-tab segmented-tab-active' : 'segmented-tab'}
            onClick={() => selectKind(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {kind === 'country' ? (
        <SearchableSelect
          id={id}
          label={label}
          value={value?.iso3 ?? ''}
          placeholder="Select a country…"
          options={(countries ?? []).map((c) => ({ value: c.iso3, label: `${c.name} (${c.iso3})` }))}
          onChange={(iso3) => onChange({ kind: 'country', iso3 })}
        />
      ) : null}
      {kind === 'wb_aggregate' ? (
        <SearchableSelect
          id={id}
          label={label}
          value={value?.iso3 ?? ''}
          placeholder="Select a World Bank aggregate…"
          options={(aggregates ?? []).map((a) => ({ value: a.iso3, label: `${a.name} (${a.iso3})`, hint: 'World Bank aggregate' }))}
          onChange={(iso3) => onChange({ kind: 'wb_aggregate', iso3 })}
        />
      ) : null}
      {kind === 'custom_group' ? (
        <Field label={label} htmlFor={`${id}-group-search`}>
          <GroupBuilder countries={countries} value={value} onChange={onChange} id={id} />
        </Field>
      ) : null}
    </div>
  );
}
