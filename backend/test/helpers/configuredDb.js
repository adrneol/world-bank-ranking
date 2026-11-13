import { getDb, initDatabase } from '../../src/db/index.js';
import { METRICS } from '../../src/config.js';
import { buildUniverse } from '../../src/domain/universe.js';
import { upsertCountries, upsertIndicator, getIndicatorByMetricKey, upsertObservations } from '../../src/db/repository.js';
import { snapshot } from '../fixtures/snapshot.js';
import { TOTAL_GDP_METRIC_KEYS, TOTAL_GDP_LAST_UPDATED, totalGdpRows } from '../fixtures/totalGdp.js';
import { PHASE5_METRIC_KEYS, PHASE5_LAST_UPDATED, phase5Rows } from '../fixtures/phase5.js';

// Historical rows outside the captured inputs are explicitly synthetic.
// A complete interval, three differently shaped peer series and a missing
// observation in phase5Rows exercise the real Movement coverage contracts.
const annualInflation = [4, 8, 6, 10, 5, 9, 12, 7, 11, 10];
const historicalEconomies = ['IND', 'USA', 'DEU', 'PAK'];
const historicalBase = {
  inflation_deflator: 5,
  exports_current: 150e9,
  imports_current: 180e9,
  fdi_inflows: 5e9,
  fdi_inflows_pct_gdp: 0.7,
  current_account: -6e9,
  reserves_ex_gold: 105e9,
  remittances_received: 20e9,
  total_current: 700e9,
  total_constant: 900e9,
  total_ppp_current: 2e12,
  total_ppp_constant: 3e12,
};
const historicalKeys = new Set([...Object.keys(historicalBase), 'inflation_cpi', 'inflation_cpi_index', 'fx_official', 'population_total']);

function historicalRows(metricKey) {
  if (!historicalKeys.has(metricKey)) return [];
  return historicalEconomies.flatMap((countryiso3code, index) => {
    const rates = annualInflation.map((rate) => rate + index);
    let cpi = 60 + index;
    return Array.from({ length: 21 }, (_, offset) => {
      const year = 2003 + offset;
      const t = year - 2004;
      const rate = rates[((t - 1) % rates.length + rates.length) % rates.length];
      if (t > 0) cpi *= 1 + rate / 100;
      const fxSlope = [1.5, 0.25, 2.5, 8][index];
      const value = {
        inflation_cpi: rate,
        inflation_cpi_index: cpi,
        fx_official: 45 + index * 5 + t * fxSlope,
        population_total: 1_100_000_000 - index * 250_000_000 + t * (17_000_000 - index * 1_000_000),
      }[metricKey] ?? historicalBase[metricKey] * (index + 1) * (1 + t * 0.04);
      return { countryiso3code, date: String(year), value };
    });
  });
}

export async function seedConfiguredDatabase() {
  const db = getDb();
  await initDatabase(db, { localFile: true });
  const { countries } = buildUniverse(snapshot.countryMetadata.rows);
  const countryIds = new Set(countries.map(({ id }) => id));
  await upsertCountries(db, countries);
  for (const metric of Object.values(METRICS)) {
    const key = metric.key;
    const source = snapshot.indicators[key];
    const rows = source?.rows
      ?? (TOTAL_GDP_METRIC_KEYS.includes(key) ? totalGdpRows(key) : phase5Rows(key));
    const vintage = source?.lastUpdated
      ?? (TOTAL_GDP_METRIC_KEYS.includes(key) ? TOTAL_GDP_LAST_UPDATED : PHASE5_LAST_UPDATED);
    await upsertIndicator(db, { ...metric, name: metric.label, source: 'WDI test fixture' });
    const indicator = await getIndicatorByMetricKey(db, key);
    const observations = [];
    for (const [input, wbLastUpdated] of [[historicalRows(key), null], [rows, vintage]]) {
      for (const row of input) {
        if (!countryIds.has(row.countryiso3code) || !Number.isFinite(row.value)) continue;
        observations.push({
          countryId: row.countryiso3code,
          indicatorId: indicator.id,
          year: Number(row.date),
          value: row.value,
          valueRaw: String(row.value),
          wbLastUpdated,
        });
      }
    }
    await upsertObservations(db, observations);
  }
  return db;
}
