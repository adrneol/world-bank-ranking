/**
 * Entity picker for the Compare workspace (Phase 6).
 *
 * One structured control for the three backend entity kinds — no hard-coded
 * region lists anywhere. Countries and official aggregates resolve names
 * from backend metadata; custom groups are request-defined member lists
 * (add/remove/search/clear, never persisted, never called a region).
 * Emits plain entity objects; entityToSpec() renders the API wire form.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { SearchableSelect } from './controls.jsx';
import { SubTabs } from './Tabs.jsx';
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
  const dialog = useRef(null);
  const trigger = useRef(null);
  const search = useRef(null);
  const [draft, setDraft] = useState({ members: [], label: '' });
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const members = value?.members ?? [];
  const selected = new Set(draft.members);
  const q = query.trim().toLowerCase();
  const candidates = countries.filter(country => !q || country.name?.toLowerCase().includes(q) || country.iso3.toLowerCase().includes(q));

  function open() {
    setDraft({ members, label: value?.label ?? '' });
    setQuery('');
    dialog.current.showModal();
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    const viewport = window.visualViewport;
    const panel = dialog.current;
    const resize = () => {
      if (viewport) panel.style.setProperty('--editor-viewport', `${viewport.height}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    return () => viewport?.removeEventListener('resize', resize);
  }, [isOpen]);

  function toggle(iso3) {
    setDraft(current => ({
      ...current,
      members: current.members.includes(iso3) ? current.members.filter(code => code !== iso3) : [...current.members, iso3],
    }));
  }

  function apply() {
    onChange({ kind: 'custom_group', members: draft.members, label: draft.label.trim() || null });
    dialog.current.close();
  }

  return <div className="group-builder">
    <button ref={trigger} type="button" className="btn btn-secondary group-editor-trigger" aria-haspopup="dialog" onClick={open}>
      {value?.label || 'Custom group'} · {members.length} {members.length === 1 ? 'economy' : 'economies'}
    </button>
    {members.length ? <p className="group-member-summary">{members.map(code => countries.find(country => country.iso3 === code)?.name ?? code).join(', ')}</p> : null}
    <p className="footnote">Request-defined country group. World Bank aggregates use a separate entity type.</p>
    <GroupPreview members={members} label={value?.label ?? null} metricKey={metricKey} />
    <dialog ref={dialog} className="group-editor" aria-labelledby={id + '-editor-title'}
      onClose={() => { setIsOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <div className="group-editor-layout">
        <header><h3 id={id + '-editor-title'}>Edit country group</h3><button type="button" className="btn btn-ghost" autoFocus onClick={() => dialog.current.close()}>Cancel</button></header>
        <div className="group-editor-search">
          <Field label="Search countries" htmlFor={id + '-group-search'}>
            <input ref={search} id={id + '-group-search'} type="search" value={query} placeholder="Country name or ISO3"
              onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  dialog.current.querySelector('.group-editor-options input')?.focus();
                }
              }} />
          </Field>
          <Field label="Group name (optional)" htmlFor={id + '-group-label'}>
            <input id={id + '-group-label'} value={draft.label} maxLength={80}
              onChange={event => setDraft(current => ({ ...current, label: event.target.value }))} />
          </Field>
        </div>
        <div className="group-editor-members">
          <span aria-live="polite">{draft.members.length} selected</span>
          <button type="button" className="btn btn-ghost" disabled={!draft.members.length}
            onClick={() => setDraft(current => ({ ...current, members: [] }))}>Clear selection</button>
          {draft.members.length ? <ul className="chip-list" aria-label="Selected economies">{draft.members.map(iso3 =>
            <li className="chip" key={iso3}><button type="button" className="chip-remove" onClick={() => { toggle(iso3); search.current?.focus({ preventScroll: true }); }}
              aria-label={'Remove ' + iso3 + ' from group'}>{countries.find(country => country.iso3 === iso3)?.name ?? iso3} ×</button></li>)}</ul> : null}
        </div>
        <div className="group-editor-options" role="group" aria-label="Available economies">
          {candidates.length ? candidates.map(({ iso3, name }) => <label key={iso3}>
            <input type="checkbox" checked={selected.has(iso3)} onChange={() => toggle(iso3)} />
            <span>{name}</span><small>{iso3}</small>
          </label>) : <p className="footnote">No matching economies.</p>}
        </div>
        <footer><button type="button" className="btn btn-primary" onClick={apply}>Apply group</button></footer>
      </div>
    </dialog>
  </div>;
}

export default function EntityPicker({ id, label, value, countries = [], aggregates = [], allowGroups = true, metricKey = null, onChange }) {
  const [kindChoice, setKindChoice] = useState(null);
  const kind = value?.kind ?? kindChoice ?? 'country';
  const tabs = allowGroups || kind === 'custom_group' ? KIND_TABS : KIND_TABS.filter(tab => tab.id !== 'custom_group');

  function selectKind(nextKind) {
    if (nextKind === kind) return;
    setKindChoice(nextKind);
    onChange(nextKind === 'custom_group' ? { kind: nextKind, members: [], label: null } : null);
  }

  return (
    <div className="entity-picker">
      <SubTabs options={tabs} active={kind} onChange={selectKind} label={label + ' type'} />
      {kind === 'country' ? (
        <SearchableSelect
          id={id}
          label={label}
          value={value?.iso3 ?? ''}
          placeholder="Select an economy…"
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
