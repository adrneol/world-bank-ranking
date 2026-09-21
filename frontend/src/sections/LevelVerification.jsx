/**
 * Level rank verification: India plus N neighbors above/below from the SAME
 * backend ranking. Neighbor rows come from the backend response verbatim —
 * nothing is synthesized at rank boundaries.
 */

import { api } from '../api/client.js';
import { metricTitle } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatRank } from '../utils/format.js';
import { Section, StatusBlock } from '../components/ui.jsx';

function VerifyTable({ focus, above, below }) {
  const rows = [
    ...(above ?? []).map((r) => ({ ...r, focusRow: false })),
    ...(focus ? [{ ...focus, rank: focus.rank, iso3: focus.iso3, country: focus.country, rawValue: focus.rawValue, rawValueText: focus.rawValueText, displayValue: focus.displayValue, focusRow: true }] : []),
    ...(below ?? []).map((r) => ({ ...r, focusRow: false })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="table-scroll" role="region" aria-label="Rank verification table" tabIndex={0}>
      <table className="table">
        <caption className="sr-only">Neighboring countries around India in the ranking</caption>
        <thead>
          <tr>
            <th scope="col" className="num">
              Rank
            </th>
            <th scope="col">Country</th>
            <th scope="col">ISO3</th>
            <th scope="col" className="num">
              Raw value
            </th>
            <th scope="col" className="num">
              Display
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.rank}-${r.iso3}`} className={r.focusRow ? 'row-focus' : undefined}>
              <th scope="row" className="num">
                {r.rank}
                {r.focusRow ? <span className="focus-tag">India</span> : null}
              </th>
              <td>{r.country}</td>
              <td className="mono">{r.iso3}</td>
              <td className="num mono">{r.rawValueText ?? String(r.rawValue)}</td>
              <td className="num">{r.displayValue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LevelVerification({ year, metricKey, neighbors }) {
  const depsKey = `verify:${metricKey}:${year ?? ''}:${neighbors}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.rankVerify({ indicator: metricKey, year, country: 'IND', neighbors }, { signal }),
    depsKey,
    { enabled: year != null && metricKey != null },
  );

  const empty = !loading && !error && data && !data.available;

  return (
    <Section
      id="verify"
      title="Verify India's rank"
      subtitle={`Level ranking for ${year ?? '—'} · ${metricTitle(metricKey)} · ${neighbors} above / below.`}
    >
      <StatusBlock loading={loading} error={error} empty={false} onRetry={retry} sectionName="rank verification" />
      {!loading && !error && data && !data.available ? (
        <p className="status status-empty">
          India has no valid observation for this metric and year
          {data.reason ? ` (${data.reason.replace(/_/g, ' ')})` : ''}. Denominator: {data.total} valid observations.
        </p>
      ) : null}
      {!loading && !error && data?.available && data.focus ? (
        <>
          <dl className="facts">
            <div>
              <dt>India rank</dt>
              <dd>{formatRank(data.focus.rank, data.focus.total)}</dd>
            </div>
            <div>
              <dt>Raw value</dt>
              <dd className="mono">
                {data.focus.rawValueText} {data.focus.unit}
              </dd>
            </div>
            <div>
              <dt>Displayed value</dt>
              <dd>{data.focus.displayValue}</dd>
            </div>
            <div>
              <dt>Rows above / below</dt>
              <dd>
                {data.focus.rowsAbove} / {data.focus.rowsBelow}
              </dd>
            </div>
          </dl>
          <VerifyTable focus={data.focus} above={data.above} below={data.below} />
          <p className="footnote">
            Exactly {data.focus.rowsAbove} valid rows precede India. Neighbors come from the same {metricTitle(metricKey)}{' '}
            ranking — never another metric.
          </p>
        </>
      ) : null}
      {empty ? null : null}
    </Section>
  );
}
