/**
 * FOCUS-COUNTRY RESOLUTION (Phase 1: generic focus abstraction).
 *
 * The database is authoritative for country names. Nothing here performs
 * economics: it only resolves which eligible country the caller asked for
 * and what display name the stored metadata gives it.
 *
 * Semantics (mirror server.js parseFocusCountry):
 *   - omitted/blank input  -> default focus (IND)
 *   - explicit valid ISO3   -> that country, name from the countries table
 *   - explicit unknown ISO3 -> name falls back to null here; the HTTP layer
 *     rejects it with 400 INVALID_COUNTRY before services are reached.
 *     Direct service callers keep the historical IND-name fallback via
 *     focusDisplayName() so existing unit tests stay green.
 */

import { FOCUS_COUNTRY } from '../config.js';
import { getCountry } from '../db/repository.js';

/**
 * DB-resolved focus descriptor for one ISO3.
 *
 * @param {object} db
 * @param {string} iso3
 * @returns {{iso3:string, name:string|null, kind:string}}
 */
export async function resolveFocus(db, iso3) {
  const code = String(iso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const row = await getCountry(db, code);
  return {
    iso3: code,
    name: row?.name ?? (code === FOCUS_COUNTRY.iso3 ? FOCUS_COUNTRY.name : null),
    kind: 'country',
  };
}

/**
 * Display name for a focus ISO3. Falls back to the default focus name only
 * when the ISO3 has no stored metadata (direct service calls with synthetic
 * inputs); HTTP callers never reach this fallback for unknown countries
 * because the route rejects them first.
 *
 * @param {object} db
 * @param {string} iso3
 * @returns {string}
 */
export async function focusDisplayName(db, iso3) {
  return (await resolveFocus(db, iso3)).name ?? FOCUS_COUNTRY.name;
}

export default { resolveFocus, focusDisplayName };
