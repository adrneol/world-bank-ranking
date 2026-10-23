/**
 * Like-for-like comparison universe panel.
 *
 * Shows the ONE authoritative universe the comparison was computed over:
 * how many eligible countries were candidates, how many were complete at
 * every required observation year, how many form the peer reference set
 * once the comparison participants are excluded, and exactly which countries
 * were excluded and why.
 *
 * The detailed country lists sit behind a disclosure: the default view stays
 * short and readable, the audit trail is one click away.
 */

import { UNIVERSE_REASON_LABELS } from '../utils/format.js';

/** One-line summary of the frozen universe. */
function UniverseSummary({ universe }) {
  if (!universe) return null;
  const counts = universe.counts ?? {};
  return (
    <div className="universe-summary" role="group" aria-label="Common universe summary">
      <div className="universe-stat">
        <span className="universe-stat-value">{counts.candidates ?? 0}</span>
        <span className="universe-stat-label">candidate countries</span>
      </div>
      <div className="universe-stat">
        <span className="universe-stat-value">{counts.complete ?? 0}</span>
        <span className="universe-stat-label">complete at every required year</span>
      </div>
      <div className="universe-stat">
        <span className="universe-stat-value">{counts.reference ?? 0}</span>
        <span className="universe-stat-label">in the peer reference set</span>
      </div>
      <div className="universe-stat">
        <span className="universe-stat-value">{counts.excludedDistinct ?? 0}</span>
        <span className="universe-stat-label">excluded countries</span>
      </div>
    </div>
  );
}

/** Expandable list of country ISO3 codes. */
function CountryList({ label, iso3List, emptyText }) {
  const list = iso3List ?? [];
  if (list.length === 0) {
    return (
      <details className="universe-details">
        <summary>{label} (0)</summary>
        <p className="footnote">{emptyText}</p>
      </details>
    );
  }
  return (
    <details className="universe-details">
      <summary>
        {label} ({list.length})
      </summary>
      <p className="mono universe-codes">{list.join(', ')}</p>
    </details>
  );
}

export default function CompareUniversePanel({ universe }) {
  if (!universe) return null;
  const excluded = universe.excluded ?? {};
  const participants = excluded.participants ?? [];
  const incomplete = excluded.incomplete ?? [];
  const nonComputable = excluded.nonComputable ?? [];
  const distinct = excluded.distinct ?? [];
  const missingObservations = universe.missingObservations ?? [];

  return (
    <section className="compare-universe" aria-label="Like-for-like comparison universe">
      <h3>Common universe</h3>
      <p className="footnote">
        One universe is built per request from the eligible countries holding a valid observation at every required
        observation year. The peer reference set excludes every comparison participant, so a peer figure can never
        count a compared entity twice.
        {universe.membershipHash ? ` Membership hash: ${universe.membershipHash}.` : ''}
      </p>
      <UniverseSummary universe={universe} />
      <details className="universe-details">
        <summary>Exclusion ledger ({distinct.length} countries)</summary>
        {participants.length > 0 ? (
          <div>
            <p className="lfl-label">Excluded as comparison participants</p>
            <ul className="universe-list">
              {participants.map((entry) => (
                <li key={entry.iso3}>
                  <span className="mono">{entry.iso3}</span> — {UNIVERSE_REASON_LABELS.comparison_participant}
                  {entry.role === 'group_member' ? ' (member of a selected group)' : ' (selected country entity)'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {incomplete.length > 0 ? (
          <div>
            <p className="lfl-label">Excluded for missing required observations</p>
            <ul className="universe-list">
              {incomplete.map((entry) => (
                <li key={entry.iso3}>
                  <span className="mono">{entry.iso3}</span> — missing {entry.missingYears.join(', ')}
                </li>
              ))}
            </ul>
            <p className="footnote">
              {incomplete.length} distinct countr{incomplete.length === 1 ? 'y is' : 'ies are'} incomplete;{' '}
              {missingObservations.length} required observation{missingObservations.length === 1 ? ' is' : 's are'} missing.
            </p>
          </div>
        ) : null}
        {nonComputable.length > 0 ? (
          <div>
            <p className="lfl-label">Excluded because the selected basis is not computable</p>
            <ul className="universe-list">
              {nonComputable.map((entry) => (
                <li key={entry.iso3}>
                  <span className="mono">{entry.iso3}</span> — {UNIVERSE_REASON_LABELS[entry.reason] ?? entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {distinct.length === 0 ? <p className="footnote">No country was excluded from the reference set.</p> : null}
      </details>
      <CountryList
        id="universe-included"
        label="Countries in the peer reference set"
        iso3List={universe.included}
        emptyText="The reference set is empty: every eligible complete country takes part in the comparison."
      />
    </section>
  );
}
