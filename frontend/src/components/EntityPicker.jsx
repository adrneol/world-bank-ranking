/**
 * Entity picker for the Compare workspace (Phase 6).
 *
 * One structured control for the three backend entity kinds — no hard-coded
 * region lists anywhere. Countries and official aggregates resolve names
 * from backend metadata; custom groups are request-defined member lists
 * (add/remove/search/clear, never persisted, never called a region).
 * Emits plain entity objects; entityToSpec() renders the API wire form.
 */

import { useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { SearchableSelect } from './controls.jsx';
import { Field } from './ui.jsx';

const KIND_TABS = [
  { id: 'country', label: 'Country' },
  { id: 'wb_aggregate', label: 'Aggregate' },
  { id: 'custom_group', label: 'Group' },
];

/** Server-validated group preview (canonical /groups/evaluate path). */
function GroupPreview({ members, label, metricKey }) {
  const depsKey = `groupeval:${members.join(',')}:${label ?? ''}:${metricKey ?? ''}`;
  const { data, loading, error } = useApi(
    (signal) => api.groupsEvaluate({ members, label, indicator: metricKey }, { signal }),
    depsKey,
    // Metric required: without it the preview endpoint has nothing to check.
    { enabled: members.length > 0 && metricKey != null },
  );
  if (members.length === 0) return null;
  if (loading) {
    return (
      <p className="status status-loading" role="status">
        Checking group…
      </p>
    );
  }
  if (error) {
    return (
      <p className="status status-empty" role="status">
        Group check: {error?.message ?? 'invalid group'} ({error?.code ?? 'REQUEST_ERROR'})
      </p>
    );
  }
  if (!data) return null;
  // Capability in plain words: totals sum member observations, the FDI/GDP
  // ratio resolves weighted legs, anything else has no group math behind it.
  const methodText =
    data.capability?.aggregation === 'SUM'
      ? 'summed member totals'
      : data.capability?.aggregation === 'WEIGHTED_RATIO'
        ? 'weighted ΣFDI / ΣGDP ratio'
        : null;
  return (
    <p className="footnote" aria-live="polite">
      {data.label} · {data.memberCount} member{data.memberCount === 1 ? '' : 's'} ·{' '}
      {data.capability?.canComputeGroupValue && methodText
        ? `group values supported (${methodText})`
        : `group values unavailable (${data.capability?.reason ?? 'unsupported metric'})`}
    </p>
  );
}

function GroupBuilder({ countries, value, onChange, id, metricKey }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const addButtonRef = useRef(null);
  const searchRef = useRef(null);
  const candidateRefs = useRef([]);
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
        .slice(0, 40),
    [countries, memberSet, q],
  );

  function add(iso3) {
    if (memberSet.has(iso3)) return;
    onChange({ kind: 'custom_group', members: [...members, iso3], label: value?.label ?? null });
    setTimeout(() => searchRef.current?.focus(), 0);
  }
  function remove(iso3) {
    onChange({ kind: 'custom_group', members: members.filter((m) => m !== iso3), label: value?.label ?? null });
    setTimeout(() => addButtonRef.current?.focus(), 0);
  }

  return (
    <div className="group-builder">
      <details className="group-name-details">
        <summary>Name this group (optional)</summary>
        <Field label="Group name" htmlFor={id + '-group-label'}>
          <input
            id={id + '-group-label'}
            type="text"
            value={value?.label ?? ''}
            maxLength={80}
            placeholder="e.g. Indian Ocean peers"
            autoComplete="off"
            onChange={(event) => onChange({ kind: 'custom_group', members, label: event.target.value || null })}
          />
        </Field>
        <p className="footnote">This name identifies the custom group in result headings and charts.</p>
      </details>
      <div className="group-selection-heading">
        <strong aria-live="polite">{members.length} selected</strong>
        <button
          ref={addButtonRef}
          type="button"
          className="btn btn-secondary"
          aria-expanded={open}
          aria-controls={`${id}-country-options`}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) setTimeout(() => searchRef.current?.focus(), 0);
          }}
        >
          {open ? 'Close country list' : 'Add countries'}
        </button>
        {members.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              onChange({ kind: 'custom_group', members: [], label: value?.label ?? null });
              setQuery('');
              setOpen(false);
              addButtonRef.current?.focus();
            }}
          >Clear selection</button>
        ) : null}
      </div>
      {members.length > 0 ? (
        <ul className="chip-list group-selected-chips" aria-label={`${members.length} selected group members`}>
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
      ) : <p className="muted group-empty">No countries selected. Choose “Add countries” to search.</p>}
      {open ? (
        <div className="group-country-menu" id={`${id}-country-options`}>
          <div className="group-add-row">
            <input
              ref={searchRef}
              id={`${id}-group-search`}
              type="search"
              value={query}
              placeholder="Search by country or ISO code…"
              aria-label="Search countries to add to the group"
              aria-controls={`${id}-candidate-list`}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && candidates.length) {
                  event.preventDefault();
                  candidateRefs.current[0]?.focus();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                  addButtonRef.current?.focus();
                }
              }}
            />
            {query ? <button type="button" className="btn btn-ghost" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>Clear search</button> : null}
          </div>
          {candidates.length > 0 ? (
            <ul className="candidate-list" id={`${id}-candidate-list`} aria-label="Available countries" role="listbox">
              {candidates.map((c, index) => (
              <li key={c.iso3}>
                <button
                  ref={(node) => { candidateRefs.current[index] = node; }}
                  type="button"
                  className="candidate-add"
                  role="option"
                  aria-selected="false"
                  onClick={() => add(c.iso3)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      const delta = event.key === 'ArrowDown' ? 1 : -1;
                      candidateRefs.current[(index + delta + candidates.length) % candidates.length]?.focus();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setOpen(false);
                      addButtonRef.current?.focus();
                    }
                  }}
                >
                  <span>
                    {c.name} <span className="mono muted">{c.iso3}</span>
                  </span>
                  <span aria-hidden="true">Add</span>
                </button>
              </li>
            ))}
          </ul>
          ) : <p className="muted group-no-matches">{q ? 'No matching countries.' : 'No more countries to add.'}</p>}
        </div>
      ) : null}
      <p className="footnote" id={`${id}-group-note`}>
        Request-defined country group — not an official World Bank aggregate. Changing membership recalculates the comparison.
      </p>
      <GroupPreview members={members} label={value?.label ?? null} metricKey={metricKey} />
    </div>
  );
}

export default function EntityPicker({ id, label, value, countries = [], aggregates = [], allowGroups = true, metricKey = null, onChange }) {
  const kind = value?.kind ?? 'country';
  // A pre-selected group stays reachable even when the metric no longer
  // offers groups (e.g. metric switched afterwards); the operation picker
  // then explains the refusal instead of stranding the selection.
  const tabs = allowGroups || kind === 'custom_group' ? KIND_TABS : KIND_TABS.filter((t) => t.id !== 'custom_group');

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
        <div className="field">
          <span className="field-label">{label}</span>
          <GroupBuilder countries={countries} value={value} onChange={onChange} id={id} metricKey={metricKey} />
        </div>
      ) : null}
    </div>
  );
}
