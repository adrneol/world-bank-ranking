export const publicPages = {
  home: ['Global Economic Research', 'Explore World Bank development indicators, economic histories, country rankings, comparisons and transparent source evidence.'],
  overview: ['Economy Overview', 'Explore historical GDP, trade and prices for a selected economy, with annual observations and source evidence.'],
  data: ['Annual Economic Data', 'Inspect annual World Development Indicators in searchable, source-aware evidence tables.'],
  rank: ['Economic Rankings', 'Explore application-calculated rankings of economies based on World Bank observations and documented eligibility rules.'],
  yoy: ['Year-over-Year Rankings', 'Compare annual percentage changes using valid observation pairs, with separate rank verification.'],
  movement: ['Economic Movement', 'Study historical growth, ranking changes, observed and common comparison universes, and rank decomposition.'],
  compare: ['Compare Economies', 'Compare countries, custom groups and World Bank aggregates using supported measures and documented coverage rules.'],
  coverage: ['Data Coverage', 'Inspect which economies and observations are available for an indicator and year.'],
  audit: ['Source Verification', 'Trace economic values to stored World Bank observations, units, release vintage and retrieval evidence.'],
  status: ['Data Status', 'Review the data vintage, refresh outcomes and indicator monitoring for the economic research platform.'],
  methodology: ['Methodology', 'Read the definitions, units, calculation methods and limits behind the platform’s economic analyses.'],
  about: ['About the Project', 'Learn how this independent research application uses World Bank World Development Indicators.'],
  'public-data': ['Public Economic Data API', 'Discover bounded, read-only access to economic observations, indicator metadata, comparisons, rankings, coverage and provenance.'],
};

export const pagePath = view => view === 'home' ? '/' : `/${view}/`;
export const viewAtPath = path => {
  const key = path.replace(/^\/+|\/+$/g, '');
  return Object.hasOwn(publicPages, key) ? key : 'home';
};
