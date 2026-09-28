/**
 * Methodology documentation page.
 *
 * Progressive documentation browsing — Family → Metric → Basis — built at
 * runtime from GET /api/indicators (the same registry the app runs on) via
 * config/methodology.js. Each level shows only valid children (fail-closed:
 * unsupported combinations can never appear); breadcrumb parents navigate
 * back without relying on the browser button. Nothing here calculates:
 * catalog values pass through for display only.
 */

import { useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { MethodologyPanel, Section, StatusBlock, UnavailableState } from '../components/ui.jsx';
import { buildMethodologyTree } from '../config/methodology.js';
import { BASIS_GUIDE, FAMILY_GUIDE, METRIC_SOURCES } from '../config/methodologyDetails.js';

/**
 * One-line family scope notes. Strictly descriptive of the displayed
 * metric sets (mirrors the Home family cards) — no economic claims.
 */
const FAMILY_DESCRIPTIONS = Object.freeze({
  gdp_per_capita: 'Output per person, nominal and PPP.',
  gdp_total: 'Total output, nominal and PPP.',
  prices: 'Consumer prices, inflation and the GDP deflator.',
  trade: 'Exports and imports of goods and services.',
  capital_flows: 'FDI inflows, levels and GDP shares.',
  exchange: 'Official exchange rates against the US dollar.',
  external: 'Current account, reserves and remittances.',
  population: 'Population size and change.',
});

function Breadcrumb({ trail }) {
  // trail: [{ label, onSelect }] with the last item current (not a button).
  // Intentional crumb treatment (not browser-hyperlink styling): quiet
  // parent links, subtle separators, emphasized current level.
  const parts = (trail ?? []).filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <nav className="crumbs" aria-label="Methodology location">
      {parts.map((part, i) => (
        <span className="crumb" key={i}>
          {i > 0 ? (
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
          ) : null}
          {i === parts.length - 1 || !part.onSelect ? (
            <span className="crumb-current" aria-current="page">
              {part.label}
            </span>
          ) : (
            <button type="button" className="crumb-link" onClick={part.onSelect}>
              {part.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function BackLink({ label, onSelect }) {
  // Secondary navigation action matching the site's button language.
  return (
    <p className="backnav-row">
      <button type="button" className="btn btn-secondary backnav" onClick={onSelect}>
        ← Back to {label}
      </button>
    </p>
  );
}

function DetailRow({ label, mono = false, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{children}</dd>
    </div>
  );
}

function BasisDetail({ family, metric, basis }) {
  const rankable = basis.rankable !== false;
  const guide = BASIS_GUIDE[basis.id] ?? null;
  const familyGuide = FAMILY_GUIDE[family.key] ?? null;
  const source = METRIC_SOURCES[metric.key] ?? { file: null, label: 'Backend metric registry and engine code' };
  // GDP movement uses ordinal positions with deterministic ISO3 tie-breaks;
  // the specialist families use competition ranking (1, 1, 3).
  const isGdp = family.key === 'gdp_per_capita' || family.key === 'gdp_total';
  return (
    <div className="card methodology-detail" role="region" aria-label={`${basis.label} methodology`}>
      <h3>{metric.label} — {basis.label}</h3>
      <p className="card-unit">{family.label}</p>
      <dl className="facts facts-grid">
        <DetailRow label="What this measures">{basis.description ?? basis.question ?? basis.label}</DetailRow>
        {guide?.how ? <DetailRow label="How it is calculated">{guide.how}</DetailRow> : null}
        <DetailRow label="Formula">
          {basis.formula ? (
            <span className="formula-scroll">{basis.formula}</span>
          ) : (
            <span>{basis.formulaAbsent ?? 'Not applicable — this basis is descriptive; see how it is calculated above.'}</span>
          )}
        </DetailRow>
        {guide?.period ? <DetailRow label="Period">{guide.period}</DetailRow> : null}
        <DetailRow label="Ranking">
          {!rankable
            ? 'Not ranked — descriptive basis, no cross-economy ordering.'
            : `${basis.rankDirection ? `${basis.rankDirection}, ` : ''}${basis.rankWording ?? 'ordered under the registry direction'}${!isGdp ? ' Competition ranking (1, 1, 3).' : ''}`}
        </DetailRow>
        {familyGuide?.benchmark ? (
          <DetailRow label="Benchmark">
            {familyGuide.benchmark}
            {basis.gapUnit ? ` Gaps expressed in ${basis.gapUnit}.` : ''}
          </DetailRow>
        ) : null}
        {guide?.eligibility ? <DetailRow label="Eligibility">{guide.eligibility}</DetailRow> : null}
        <DetailRow label="Observed vs Like-for-like">
          Identical formulas on two universes: Observed (all eligible economies with required data) vs
          Like-for-like (economies present in every compared period).
        </DetailRow>
        {familyGuide?.universe ? <DetailRow label="Universe">{familyGuide.universe}</DetailRow> : null}
        <DetailRow label="Units">{basis.unit ?? metric.unit}</DetailRow>
        {guide?.distinct ? <DetailRow label="Why this basis is distinct">{guide.distinct}</DetailRow> : null}
        {familyGuide?.missing ? <DetailRow label="Missing data">{familyGuide.missing}</DetailRow> : null}
        <DetailRow label="WDI indicator" mono>{metric.indicatorCode}</DetailRow>
        <DetailRow label="Source">{source.label}</DetailRow>
        {guide?.caveats && guide.caveats.length > 0 ? (
          <div className="span-all">
            <dt>Caveats</dt>
            <dd>
              <ul className="warnings">
                {guide.caveats.map((caveat, i) => (
                  <li key={i}>{caveat}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export default function Methodology() {
  const { data, loading, error, retry } = useApi((signal) => api.indicators({ signal }), 'methodology:indicators');
  const [familyKey, setFamilyKey] = useState('');
  const [metricKey, setMetricKey] = useState('');
  const [basisId, setBasisId] = useState('');

  const tree = useMemo(() => (data ? buildMethodologyTree(data) : null), [data]);
  const families = tree?.families ?? [];
  // Fail-closed lookups: a stale/invalid key resolves to unselected, so an
  // impossible combination can never render.
  const family = families.find((f) => f.key === familyKey) ?? null;
  const metric = family?.metrics.find((m) => m.key === metricKey) ?? null;
  const basis = metric?.bases.find((b) => b.id === basisId) ?? null;

  const empty = !loading && !error && !tree;

  function selectFamily(next) {
    setFamilyKey(next);
    setMetricKey('');
    setBasisId('');
  }
  function selectMetric(next) {
    setMetricKey(next);
    setBasisId('');
  }
  function selectBasis(next) {
    setBasisId(next);
  }
  function showAllFamilies() {
    selectFamily('');
  }

  return (
    <Section
      id="methodology"
      title="Methodology"
      subtitle="How every analysis on this site is calculated — family by family, from the same registry the application runs on."
    >
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="methodology catalog" />
      {!loading && !error && !tree ? (
        <UnavailableState reason="methodology_unavailable" hint="The methodology catalog could not be loaded. Retry to reload it from the backend." />
      ) : null}
      {!loading && !error && tree ? (
        <>
          <Breadcrumb
            trail={[
              { label: 'Methodology', onSelect: family ? showAllFamilies : null },
              ...(family ? [{ label: family.label, onSelect: metric ? () => selectFamily(family.key) : null }] : []),
              ...(metric ? [{ label: metric.shortLabel ?? metric.label, onSelect: basis ? () => selectMetric(metric.key) : null }] : []),
              ...(basis ? [{ label: basis.label }] : []),
            ]}
          />
          {!family ? (
            <>
              <p className="section-sub">
                Select a family to browse its metrics, then a basis to read the full methodology.
              </p>
              <div className="cards" role="region" aria-label="Methodology families">
                {families.map((f) => (
                  <article key={f.key} className="card family-card">
                    <h3>{f.label}</h3>
                    {FAMILY_DESCRIPTIONS[f.key] ? <p className="card-unit">{FAMILY_DESCRIPTIONS[f.key]}</p> : null}
                    <p className="card-unit">
                      {f.metrics.length} metric{f.metrics.length === 1 ? '' : 's'} · {f.metrics.reduce((n, m) => n + m.bases.length, 0)} bases
                    </p>
                    <p className="card-action">
                      <button type="button" className="btn btn-secondary home-card-link" onClick={() => selectFamily(f.key)}>
                        Explore →
                      </button>
                    </p>
                  </article>
                ))}
              </div>
            </>
          ) : null}
          {family && !metric ? (
            <>
              <BackLink label="All families" onSelect={showAllFamilies} />
              <h3 className="subhead">{family.label} metrics</h3>
              {FAMILY_DESCRIPTIONS[family.key] ? <p className="section-sub">{FAMILY_DESCRIPTIONS[family.key]}</p> : null}
              <div className="cards" role="region" aria-label={`${family.label} metrics`}>
                {family.metrics.map((m) => (
                  <article key={m.key} className="card family-card">
                    <h3>{m.shortLabel ?? m.label}</h3>
                    <p className="card-unit">
                      {m.unit} · {m.bases.length} {m.bases.length === 1 ? 'basis' : 'bases'}
                    </p>
                    <p className="card-action">
                      <button type="button" className="btn btn-secondary home-card-link" onClick={() => selectMetric(m.key)}>
                        Explore →
                      </button>
                    </p>
                  </article>
                ))}
              </div>
            </>
          ) : null}
          {family && metric && !basis ? (
            <>
              <BackLink label={family.label} onSelect={() => selectFamily(family.key)} />
              <h3 className="subhead">{metric.shortLabel ?? metric.label} bases</h3>
              <div className="cards" role="region" aria-label={`${metric.shortLabel ?? metric.label} bases`}>
                {metric.bases.map((b) => (
                  <article key={b.id} className="card family-card">
                    <h3>{b.label}</h3>
                    <p className="card-unit">{b.description ?? b.question ?? b.label}</p>
                    <p className="card-action">
                      <button type="button" className="btn btn-secondary home-card-link" onClick={() => selectBasis(b.id)}>
                        Read methodology →
                      </button>
                    </p>
                  </article>
                ))}
              </div>
            </>
          ) : null}
          {family && metric && basis ? (
            <>
              <BackLink label={metric.shortLabel ?? metric.label} onSelect={() => selectMetric(metric.key)} />
              <BasisDetail family={family} metric={metric} basis={basis} />
            </>
          ) : null}
          <MethodologyPanel
            source="World Bank World Development Indicators"
            indicatorCode={metric?.indicatorCode ?? null}
            derived="Documentation of backend-declared operations; nothing here calculates"
            formula={basis?.formula ?? null}
          >
            <p className="footnote">
              Methodology references for this family:{' '}
              {[...new Set((family?.metrics ?? []).map((m) => METRIC_SOURCES[m.key]?.label).filter(Boolean))].join(
                '; ',
              ) || 'backend registry'}.
              Rankings use full backend precision; formatting is presentation-only.
              {tree?.methodology?.rankDisclaimer ? ` ${tree.methodology.rankDisclaimer}` : ''}
            </p>
          </MethodologyPanel>
        </>
      ) : null}
    </Section>
  );
}

// Re-exported for tests that pin the browsing contract without rendering.
export { FAMILY_DESCRIPTIONS };
