/**
 * YoY rank verification: India plus N neighbors from the SAME YoY-ranked
 * dataset, with previous/current raw values and the coverage block.
 */

import { api } from '../api/client.js';
import { metricTitle } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatYoy } from '../utils/format.js';
import { Section, StatusBlock } from '../components/ui.jsx';

function YoyTable({ focus, above, below }) {
  const rows = [
    ...(above ?? []).map((r) => ({ ...r, focusRow: false })),
    ...(focus
      ? [
          {
            ...focus,
            focusRow: true,
          },
        ]
      : []),
    ...(below ?? []).map((r) => ({ ...r, focusRow: false })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="table-scroll" role="region" aria-label="YoY verification table" tabIndex={0}>
      <table className="table">
        <caption className="sr-only">Neighboring countries around India in the YoY ranking</caption>
        <thead>
          <tr>
            <th scope="col" className="num">
              YoY rank
            </th>
            <th scope="col">Country</th>
            <th scope="col">ISO3</th>
            <th scope="col" className="num">
              Previous raw
            </th>
            <th scope="col" className="num">
              Current raw
            </th>
            <th scope="col" className="num">
              YoY %
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
              <td className="num mono" title={`Display: ${r.previousValueDisplay}`}>
                {r.previousValueText}
              </td>
              <td className="num mono" title={`Display: ${r.currentValueText}`}>
                {r.currentValueText}
              </td>
              <td className="num">{formatYoy(r.yoyPercent, r.yoyDisplay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function YoyVerification({ year, metricKey, neighbors }) {
  const depsKey = `yoyverify:${metricKey}:${year ?? ''}:${neighbors}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.yoyVerify({ indicator: metricKey, year, country: 'IND', neighbors }, { signal }),
    depsKey,
    { enabled: year != null && metricKey != null },
  );

  return (
    <Section
      id="yoy-verify"
      title="Verify India's YoY rank"
      subtitle={`YoY ranking for ${year ?? '—'} · ${metricTitle(metricKey)} · ${neighbors} above / below.`}
    >
      <StatusBlock loading={loading} error={error} empty={false} onRetry={retry} sectionName="YoY verification" />
      {!loading && !error && data && !data.available ? (
        <p className="status status-empty">
          India has no calculable YoY for this metric and year
          {data.reason ? ` (${data.reason.replace(/_/g, ' ')})` : ''}.
        </p>
      ) : null}
      {!loading && !error && data?.available && data.focus ? (
        <>
          <dl className="facts">
            <div>
              <dt>India YoY rank</dt>
              <dd>
                {data.focus.rank} / {data.denominator}
              </dd>
            </div>
            <div>
              <dt>YoY change</dt>
              <dd>{formatYoy(data.focus.yoyPercent, data.focus.yoyDisplay)}</dd>
            </div>
            <div>
              <dt>Previous raw</dt>
              <dd className="mono">{data.focus.previousValueText}</dd>
            </div>
            <div>
              <dt>Current raw</dt>
              <dd className="mono">{data.focus.currentValueText}</dd>
            </div>
            <div>
              <dt>YoY denominator vs level</dt>
              <dd>
                {data.denominator} pairs vs {data.levelDenominatorForComparison} level observations
              </dd>
            </div>
          </dl>
          <YoyTable focus={data.focus} above={data.above} below={data.below} />
        </>
      ) : null}
    </Section>
  );
}
