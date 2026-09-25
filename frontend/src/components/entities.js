/**
 * Entity helpers (Phase 6): wire-spec rendering and display names for the
 * three backend entity kinds. Pure functions, no JSX — kept separate so
 * component files export components only.
 */

export function entityToSpec(entity) {
  if (!entity) return '';
  if (entity.kind === 'country') return `country:${entity.iso3}`;
  if (entity.kind === 'wb_aggregate') return `aggregate:${entity.iso3}`;
  if (entity.kind === 'custom_group') return `group:${[...entity.members].sort().join(',')}`;
  return '';
}

/** Parse a wire spec back to an entity object (lenient: null when malformed). */
export function parseEntitySpecString(spec, label = null) {
  if (!spec || typeof spec !== 'string') return null;
  const colon = spec.indexOf(':');
  if (colon < 0) return null;
  const kind = spec.slice(0, colon).trim().toLowerCase();
  const payload = spec.slice(colon + 1).trim();
  if (kind === 'country' && /^[A-Za-z]{3}$/.test(payload)) {
    return { kind: 'country', iso3: payload.toUpperCase() };
  }
  if (kind === 'aggregate' && /^[A-Za-z]{3}$/.test(payload)) {
    return { kind: 'wb_aggregate', iso3: payload.toUpperCase() };
  }
  if (kind === 'group' || kind === 'custom_group') {
    // An empty payload ('group:') is an in-progress empty group, NOT a
    // malformed spec: the builder needs to stay on the Group tab with zero
    // members so the user can add some. Submission still requires members
    // (canFetch) and the backend still rejects empty groups (EMPTY_GROUP).
    if (payload === '') return { kind: 'custom_group', members: [], label: cleanLabel(label) };
    const members = [...new Set(payload.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s)))].sort();
    // Labels travel beside the spec (labelA/labelB params + URL state),
    // never inside it; attach here so reloaded builders keep their name.
    if (members.length > 0) return { kind: 'custom_group', members, label: cleanLabel(label) };
  }
  return null;
}

function cleanLabel(label) {
  return typeof label === 'string' && label.trim() !== '' ? label.trim().slice(0, 80) : null;
}

export function entityDisplayName(entity, countries = [], aggregates = []) {
  if (!entity) return '—';
  if (entity.kind === 'country') {
    return countries.find((c) => c.iso3 === entity.iso3)?.name ?? entity.iso3;
  }
  if (entity.kind === 'wb_aggregate') {
    return aggregates.find((c) => c.iso3 === entity.iso3)?.name ?? entity.iso3;
  }
  if (entity.kind === 'custom_group') {
    return entity.label || `User-selected group (${entity.members.length})`;
  }
  return '—';
}
