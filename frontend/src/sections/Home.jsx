/**
 * Public landing page.
 *
 * Explains what the site is and routes into the analytical workspaces —
 * it is NOT another Overview (no ranks, no focus-country analysis here).
 * Family cards are data-driven from GET /api/indicators (same registry the
 * app runs on); all numbers shown are counts of documented analyses, never
 * analytical results. Renders its static content without waiting for data;
 * family cards show a truthful fallback when metadata is unavailable.
 * Existing design language only (hero, cards, badges).
 */

import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { Section, StatusBlock } from '../components/ui.jsx';

/**
 * One-line family summaries naming the metric scope shown on each card.
 * Strictly descriptive of the displayed metric sets — no economic claims.
 */
const FAMILY_BLURBS = Object.freeze({
  gdp_per_capita: 'Output per person, nominal and PPP.',
  gdp_total: 'Total output, nominal and PPP.',
  prices: 'Consumer prices, inflation and the GDP deflator.',
  trade: 'Exports and imports of goods and services.',
  capital_flows: 'FDI inflows, levels and GDP shares.',
  exchange: 'Official exchange rates against the US dollar.',
  external: 'Current account, reserves and remittances.',
  population: 'Population size and change.',
});

export default function Home({ sourceName, onOpenView, onOpenSubject }) {
  const { data, loading, error, retry } = useApi((signal) => api.indicators({ signal }), 'home:indicators');
  const families = (data?.subjects ?? [])
    .map((subject) => {
      const metrics = (data?.production ?? []).filter((m) => m.subject === subject.key);
      return { ...subject, metrics };
    })
    .filter((family) => family.metrics.length > 0);
  const failed = !loading && (!data || families.length === 0);

  return (
    <div role="tabpanel" id="panel-home" aria-labelledby="tab-home">
      <div className="insight home-hero" aria-label="Introduction">
        <p className="eyebrow eyebrow-dark">Transparent · Reproducible · World Bank WDI</p>
        <h2 className="analysis-title">Quality analysis of World Bank raw data — with the methods shown</h2>
        <p>
          This site investigates economies through World Bank World Development Indicators raw
          observations. Every rank, change rate, benchmark and gap on this site is calculated here,
          openly, from those observations — the World Bank does not publish them. Methods are
          documented per analysis, missing data is never filled in, and full precision is kept
          until display.
        </p>
        <div className="analysis-header-side">
          <button type="button" className="btn btn-primary" onClick={() => onOpenView?.('overview')}>
            Explore analysis
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onOpenView?.('methodology')}>
            Read methodology
          </button>
        </div>
      </div>

      <Section
        id="home-families"
        title="What you can investigate"
        subtitle="Analytical families. Select one to open it in the Movement workspace."
      >
        <StatusBlock loading={loading} error={null} empty={false} sectionName="analysis families" />
        {failed && !error ? (
          <p className="status status-empty" role="status">
            Family metadata is unavailable right now — use Explore analysis above to enter the workspaces directly.
          </p>
        ) : null}
        {error ? (
          <div className="status status-error" role="alert">
            <p>Could not load analysis families: {error?.message ?? 'Unknown error.'}</p>
            <button type="button" className="btn btn-secondary" onClick={retry}>
              Retry
            </button>
          </div>
        ) : null}
        {!loading && !error && families.length > 0 ? (
          <div className="cards" role="region" aria-label="Analytical families">
            {families.map((family) => (
              <article key={family.key} className="card family-card" aria-label={`${family.label} analyses`}>
                <h3>{family.label}</h3>
                {FAMILY_BLURBS[family.key] ? <p className="card-unit">{FAMILY_BLURBS[family.key]}</p> : null}
                <p className="card-unit">
                  {family.metrics.length} metric{family.metrics.length === 1 ? '' : 's'} ·{' '}
                  {family.metrics.map((m) => m.shortLabel ?? m.label).join(' · ')}
                </p>
                <p className="card-action">
                  <button
                    type="button"
                    className="btn btn-secondary home-card-link"
                    onClick={() => onOpenSubject?.(family.key)}
                  >
                    Open in Movement →
                  </button>
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </Section>

      <Section
        id="home-provenance"
        title="Source and provenance"
        subtitle="Where the numbers come from — and what this site does with them."
      >
        <dl className="facts facts-grid">
          <div>
            <dt>Source data</dt>
            <dd>{sourceName ?? 'World Bank WDI'}</dd>
          </div>
          <div>
            <dt>Analysis</dt>
            <dd>Calculated here from raw observations</dd>
          </div>
          <div>
            <dt>Missing data</dt>
            <dd>Never zero-filled or interpolated</dd>
          </div>
          <div>
            <dt>Methods</dt>
            <dd>Documented per analytical basis</dd>
          </div>
        </dl>
        <div className="analysis-header-side home-cta-row">
          <button type="button" className="btn btn-secondary" onClick={() => onOpenView?.('methodology')}>
            Explore methodology →
          </button>
        </div>
        <p className="footnote">
          Data freshness, vintage and refresh state always come from the live backend — see the
          Status view. Display dates elsewhere on this page are site-content labels only.
        </p>
      </Section>
    </div>
  );
}
