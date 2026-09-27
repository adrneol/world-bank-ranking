/**
 * Shared mobile presentation for movement economy lists (Phase 5, R-08).
 *
 * Generalizes the RankMovement mobile-card pattern for all movement
 * families: identical shell, visual language and breakpoint behavior, with
 * family-specific display fields supplied by callers.
 *
 * SHARED SHELL + FAMILY-SPECIFIC DISPLAY FIELDS: the shell owns layout,
 * focus highlighting, rank formatting and the details disclosure. Callers
 * pass backend-derived rows plus render callbacks that format
 * already-computed backend values for display only. Nothing here derives
 * economics: no ranks, benchmarks, gaps, growth rates, orderings or
 * universe membership are computed — `rankOf` maps a row to its backend
 * analytical rank (never a render position), so search/filter/sort/
 * pagination cannot renumber what is displayed.
 *
 * Breakpoint: `(max-width: 40rem)`, the stylesheet's own mobile breakpoint,
 * so JS shells and CSS rules switch at the same width.
 */

import { useId, useState } from 'react';

/**
 * Backend analytical rank for display. A missing rank stays an explicit
 * em-dash — filtering can hide rows but never renumbers ranks.
 * (Module-private: presentation detail of the shell below.)
 */
function movementRankCell(rank) {
  return rank === null || rank === undefined ? '—' : `#${rank}`;
}

/**
 * One labeled display field inside a mobile card summary (mirrors the
 * desktop details-grid field shape: label + value, tabular numerals for
 * numbers, monospace available via `mono`).
 */
export function CardField({ label, mono = false, num = false, children }) {
  const cls = mono ? 'mono' : num ? 'num' : undefined;
  return (
    <div>
      <dt>{label}</dt>
      <dd className={cls}>{children}</dd>
    </div>
  );
}

/**
 * Mobile shell for economy result lists. Same backend rows and analytical
 * values as the desktop table; only the layout differs. Cards are
 * width-constrained to their container (never table geometry), so content
 * reflows vertically at 320–414px. One economy expanded at a time, like
 * the desktop tables. `renderDetails` is optional: lists whose desktop
 * table has no expandable details pass none and get no toggle.
 */
export function EconomyMobileList({
  rows,
  rankOf,
  caption,
  focusIso = 'IND',
  focusName = 'India',
  renderSummary,
  renderDetails = null,
}) {
  const listId = useId();
  const [openIso, setOpenIso] = useState(null);
  return (
    <div className="economy-cards" role="list" aria-label={caption ?? 'Economies'}>
      {(rows ?? []).map((r) => {
        const open = openIso === r.iso3;
        const detailId = `${listId}-${r.iso3}-details`;
        const rank = rankOf(r);
        return (
          <div className="card economy-card" role="listitem" key={r.iso3}>
            <div className="economy-card-head">
              <span>{movementRankCell(rank)}</span>
              <span className="economy-card-name">
                {r.name ?? r.iso3}
                {r.iso3 === focusIso ? <span className="focus-tag"> {focusName}</span> : null}
              </span>
              <span className="mono">{r.iso3}</span>
            </div>
            <dl className="facts">{renderSummary(r)}</dl>
            {renderDetails ? (
              <button
                type="button"
                className="btn btn-ghost economy-card-toggle details-toggle"
                aria-expanded={open}
                aria-controls={detailId}
                onClick={() => setOpenIso(open ? null : r.iso3)}
              >
                {open ? 'Hide details' : 'Details'}
              </button>
            ) : null}
            {renderDetails && open ? (
              <div className="economy-card-details" id={detailId}>
                {renderDetails(r)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default EconomyMobileList;
