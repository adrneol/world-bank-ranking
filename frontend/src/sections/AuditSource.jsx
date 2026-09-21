/**
 * Audit / source panel: everything needed to independently verify a result.
 * All fields come from backend responses (metadata, observations, yearly
 * result, methodology blocks) — nothing is asserted by the frontend.
 */

import { api } from '../api/client.js';
import { METRICS } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatYoy } from '../utils/format.js';
import { Section, StatusBlock } from '../components/ui.jsx';

export default function AuditSource({ year, metricKey }) {
  const depsKey = `audit:${metricKey}:${year ?? ''}`;
  const { data, loading, error, retry } = useApi(
    async (signal) => {
      const options = { signal };
      const [metadata, observation, yearly] = await Promise.all([
        api.metadata(options),
        api.observations({ indicator: metricKey, year, country: 'IND' }, options),
        api.indiaRanking({ startYear: year, endYear: year }, options),
      ]);
      return { metadata, observation, yearly };
    },
    depsKey,
    { enabled: year != null && metricKey != null },
  );

  const meta = METRICS[metricKey];
  const indicator = data?.metadata?.indicators?.find((i) => i.metric_key === metricKey) ?? null;
  const obs = data?.observation?.observation ?? null;
  const cell = data?.yearly?.rows?.[0]?.[metricKey] ?? null;
  const methodology = data?.metadata?.methodology ?? data?.observation?.methodology ?? null;

  return (
    <Section
      id="audit"
      title="Audit / source"
      subtitle={`Verifiable provenance for ${year ?? '—'} · ${meta?.title ?? metricKey}.`}
    >
      <StatusBlock loading={loading} error={error} empty={false} onRetry={retry} sectionName="audit data" />
      {!loading && !error && data ? (
        <dl className="facts facts-grid">
          <div>
            <dt>Source</dt>
            <dd>World Bank World Development Indicators (WDI)</dd>
          </div>
          <div>
            <dt>API base URL</dt>
            <dd className="mono">{data.metadata?.apiBaseUrl ?? '—'}</dd>
          </div>
          <div>
            <dt>Indicator code</dt>
            <dd className="mono">{meta?.indicatorCode}</dd>
          </div>
          <div>
            <dt>Indicator name</dt>
            <dd>{indicator?.name ?? meta?.title}</dd>
          </div>
          <div>
            <dt>Unit</dt>
            <dd>{meta?.unit}</dd>
          </div>
          <div>
            <dt>World Bank lastupdated</dt>
            <dd>{obs?.wbLastUpdated ?? '—'}</dd>
          </div>
          <div>
            <dt>Local retrieval timestamp</dt>
            <dd className="mono">{obs?.fetchedAt ?? '—'}</dd>
          </div>
          <div>
            <dt>Eligible metadata universe</dt>
            <dd>{data.metadata?.universe?.eligible ?? '—'} eligible of {data.metadata?.universe?.total ?? '—'} total</dd>
          </div>
          <div>
            <dt>India raw value</dt>
            <dd className="mono">{obs?.valueRaw ?? (cell?.indiaValueRaw ?? '—')}</dd>
          </div>
          <div>
            <dt>India displayed value</dt>
            <dd>{cell?.indiaValueDisplay?.formatted ?? '—'}</dd>
          </div>
          <div>
            <dt>Previous-year raw value</dt>
            <dd className="mono">{cell?.previousYearValue ?? '—'}</dd>
          </div>
          <div>
            <dt>YoY formula</dt>
            <dd className="mono">((currentRaw / previousRaw) − 1) × 100</dd>
          </div>
          <div>
            <dt>YoY</dt>
            <dd>{cell ? formatYoy(cell.indiaYoY, cell.indiaYoYDisplay) : '—'}</dd>
          </div>
          <div>
            <dt>Rank / denominator</dt>
            <dd>
              {cell?.indiaRank != null ? `${cell.indiaRank} / ${cell.total}` : '—'}
            </dd>
          </div>
          <div>
            <dt>Tie-break</dt>
            <dd>{methodology?.levelRanking ?? 'value DESC, ISO3 ASC; 1-based ordinal positions.'}</dd>
          </div>
          <div>
            <dt>Rank wording</dt>
            <dd>{methodology?.rankWording ?? 'Rank calculated from World Bank WDI observations.'}</dd>
          </div>
        </dl>
      ) : null}
      {!loading && !error && data ? (
        <>
          <p className="footnote">{methodology?.rankDisclaimer}</p>
          <p className="footnote">
            Indicator page:{' '}
            <a href={meta?.worldBankPage ?? `https://data.worldbank.org/indicator/${meta?.indicatorCode}`} target="_blank" rel="noreferrer">
              {meta?.indicatorCode}
            </a>
          </p>
        </>
      ) : null}
    </Section>
  );
}
