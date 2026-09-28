/**
 * Presentation-only header-context resolver (Round 2G).
 *
 * The global header must be VIEW-AWARE: different workspaces have
 * different temporal/entity semantics, so one universal country/year rule
 * leaks the wrong context (e.g. Overview's single year into Movement's
 * period header, or a focus country into the entity-neutral Compare and
 * Status workspaces). This module maps already-resolved view state to the
 * two header identity strings. No economics here: it formats labels only
 * and never calculates, fetches, or mutates anything.
 */

export const INFO_VIEWS = Object.freeze(['home', 'methodology', 'about']);

/**
 * Resolve the site-identity strings for the global header.
 *
 * @param {object} args
 * @param {string} args.view - active view id
 * @param {string} args.country - focus country ISO3 (already resolved)
 * @param {string} args.focusName - focus country display name (already resolved)
 * @param {number|null} args.year - single analytical year, or null when unknown
 * @param {number|null} args.yearA - movement period start, or null
 * @param {number|null} args.yearB - movement period end, or null
 * @returns {{ primary: string, secondary: string }}
 */
export function getHeaderContext({ view, country, focusName, year, yearA, yearB }) {
  const name = focusName ?? country ?? '';
  // Informational pages: neutral project identity. Never a country, ISO3,
  // year, or the word "ranking".
  if (INFO_VIEWS.includes(view)) {
    return { primary: 'World Bank WDI', secondary: 'Economic data analysis' };
  }
  // Movement is a period/range analysis: the header communicates the
  // compared endpoints only. The middle year (when present) and the
  // unrelated global single-year filter stay out of the header.
  if (view === 'movement') {
    const primary = `World Bank WDI · ${country}`;
    if (yearA == null || yearB == null) {
      return { primary, secondary: `${name} — Select period` };
    }
    return { primary, secondary: `${name} — ${yearA} → ${yearB}` };
  }
  // Compare is entity-vs-entity: the page shows its own entities/years,
  // so the global header stays neutral.
  if (view === 'compare') {
    return { primary: 'World Bank WDI', secondary: 'Entity comparison' };
  }
  // Status is about application/data state, not a country analysis.
  if (view === 'status') {
    return { primary: 'World Bank WDI', secondary: 'Data status & refresh' };
  }
  // Single-year analytical views (overview, data, rank, yoy, coverage,
  // audit …): focus country plus its meaningful analytical year.
  return {
    primary: `World Bank WDI · ${country}`,
    secondary: year != null ? `${name} — ${year}` : name,
  };
}
