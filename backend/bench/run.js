/** Safe deterministic local benchmark. Never loads .env or real database files. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { observeDatabase } from '../src/db/metrics.js';

process.env.NODE_ENV = 'test';
await import('../test/isolation.js');
process.env.PUBLIC_READ_API_ENABLED = '1';
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; };
const source = path.resolve(option('--source', fileURLToPath(new URL('../', import.meta.url))));
const load = name => import(pathToFileURL(path.join(source, name)));
const { createMemoryDb } = await load('src/db/index.js');
const repo = await load('src/db/repository.js');
const { METRICS } = await load('src/config.js');
const { snapshot } = await load('test/fixtures/snapshot.js');
const { buildUniverse } = await load('src/domain/universe.js');
const { buildIndiaYearlyRows } = await load('src/services/indiaYearly.js');
const { buildFocusHistory } = await load('src/services/focusHistory.js');
const { buildFullRanking } = await load('src/services/fullRanking.js');
const { buildRankVerification } = await load('src/services/rankVerification.js');
const { buildCompareResponse } = await load('src/services/entityCompare.js');
const { buildCoveragePanel } = await load('src/services/coverageService.js');
const { buildPricesMovement } = await load('src/services/pricesMovementService.js');
const { getCachedAvailableYears } = await load('src/services/yearsCache.js');
const { runIntegrityChecks } = await load('src/services/integrity.js');
const { getCacheStatus } = await load('src/wb/ingest.js');
const { createApp } = await load('src/server.js');
const raw = await createMemoryDb();
const observed = observeDatabase(raw), db = observed.db;
const yearCount = Number(option('--years', '66'));
if (![22, 66].includes(yearCount)) throw Error('Use --years 22 or 66');
const countries = buildUniverse(snapshot.countryMetadata.rows).countries;
await repo.upsertCountries(db, countries);
const eligible = countries.filter(c => !c.isAggregate);
const selected = [...eligible, ...countries.filter(c => c.isAggregate).slice(0, 3)];
let rowCount = 0;
for (const [m, metric] of Object.values(METRICS).entries()) {
  await repo.upsertIndicator(db, { ...metric, source: 'SYNTHETIC BENCHMARK ONLY' });
  const indicator = await repo.getIndicatorByMetricKey(db, metric.key), rows = [];
  for (const [i, country] of selected.entries()) for (let year = 2026 - yearCount; year < 2026; year++) {
    if ((i + year + m) % 19 === 0) continue; // deterministic sparse coverage
    const signed = ['current_account','fdi_inflows'].includes(metric.key);
    const value = (i + year) % 31 === 0 ? 0 : (signed && i % 3 === 0 ? -1 : 1) * ((i + 1) * 1000 + year * (m + 1) / 7);
    rows.push({ countryId: country.id, indicatorId: indicator.id, year, value, valueRaw: String(value), wbLastUpdated: i % 7 ? '2026-01-01' : '2025-12-01' });
  }
  rowCount += rows.length;
  await repo.upsertObservations(db, rows);
}
await raw.execute("UPDATE observations SET fetched_at='2026-01-02T00:00:00.000Z'");
await repo.upsertDatasetStateInner(db, { ...await repo.computeDatasetState(db), contentVersion: 1 });
const results = [];
const stable = value => JSON.stringify(value, (key, v) => ['cached','time','checkedAt','ageHours','elapsedMs','durationMs','updated_at'].includes(key) ? undefined : typeof v === 'bigint' ? String(v) : v);
async function measure(name, run, samples = 5) {
  if (process.argv.includes('--paired-only')) return;
  console.log(`Benchmark: ${name}`);
  const runs = []; let value;
  for (let i = 0; i < samples; i++) {
    observed.reset(); const memory = process.memoryUsage().heapUsed, cpu = process.cpuUsage(), start = performance.now();
    value = await run();
    runs.push({ ...observed.snapshot(), ms: performance.now() - start, cpuMicros: Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0), heapDelta: process.memoryUsage().heapUsed - memory });
  }
  const times = runs.map(r => r.ms).sort((a,b)=>a-b), body = stable(value);
  results.push({ name, samples, cold: runs[0], warm: runs.slice(1), p50: times[Math.floor(times.length/2)], p95: samples >= 20 ? times[Math.ceil(samples*.95)-1] : null, bytes: Buffer.byteLength(body), fingerprint: createHash('sha256').update(body).digest('hex'), ...(name === 'data-status' ? { normalizedPayload: JSON.parse(body) } : {}) });
}
try {
  await measure('country-registry', () => repo.listCountries(db));
  await measure('indicator-registry', () => repo.listIndicators(db));
  await measure('year-discovery', () => getCachedAvailableYears(db));
  await measure('overview', () => buildIndiaYearlyRows(db,{focusIso3:'IND',subject:'gdp_total',startYear:2024,endYear:2024}));
  await measure('history-single', () => buildFocusHistory(db,{country:'IND',series:['total_current'],startYear:2004,endYear:2025}));
  await measure('history-multiple', () => buildFocusHistory(db,{country:'IND',series:['total_current','total_constant','real_gdp_growth'],startYear:2004,endYear:2025}));
  await measure('ranking', () => buildFullRanking(db,{focusIso3:'IND',metricKey:'total_current',year:2024}));
  await measure('rank-verification', () => buildRankVerification(db,{focusIso3:'IND',metricKey:'total_current',year:2024}));
  const compare = {metricKey:'total_current',basis:'total_current',operation:'level',entityA:'country:IND',entityB:'country:USA',yearA:2004,yearB:2024};
  for (const [name,params] of Object.entries({ 'country-country':{},'country-group':{entityB:'group:USA,DEU'},'group-group':{entityA:'group:IND,CHN',entityB:'group:USA,DEU'},'country-aggregate':{entityB:'aggregate:WLD'},'like-for-like':{entityA:'group:IND,CHN',entityB:'group:USA,DEU',groupMode:'like_for_like'} })) {
    await measure(name, () => buildCompareResponse(db,{...compare,...params}));
  }
  await measure('movement', () => buildPricesMovement(db,{metricKey:'inflation_cpi',yearA:2004,yearB:2024,focusIso3:'IND'}));
  await measure('coverage', () => buildCoveragePanel(db,{focusIso3:'IND',subject:'gdp_total',year:2024}));
  await measure('audit', () => runIntegrityChecks(db), 2);
  await measure('cache-status', () => getCacheStatus(db));
  const server = createApp({db,autoRefresh:false}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  try {
    for (const [name,url] of Object.entries({'public-history':'/api/public/focus/history?country=IND&series=total_current&startYear=2004&endYear=2025','yoy-ranking':'/api/yoy-ranking?country=IND&indicator=total_current&year=2024&readOnly=1','data-status':'/api/data-status?readOnly=1'})) {
      await measure(name, async()=>{const r=await fetch(base+url,{headers:{Connection:'close'}});if(!r.ok)throw Error(name+': HTTP '+r.status);return r.json();});
    }
    await measure('concurrent-overview', () => Promise.all(Array.from({length:8},()=>buildIndiaYearlyRows(db,{focusIso3:'IND',subject:'gdp_total',startYear:2024,endYear:2024}))),2);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
  const plans = await raw.execute({sql:'EXPLAIN QUERY PLAN SELECT year,value,value_raw FROM observations WHERE country_id=? AND indicator_id=? AND year BETWEEN ? AND ? ORDER BY year',args:['IND',1,2004,2025]});
  const indexes = await raw.execute("PRAGMA index_list('observations')");
  let paired = null;
  if (option('--paired-source', null)) {
    const baseline = await import(pathToFileURL(path.join(path.resolve(option('--paired-source', '')), 'src/services/indiaYearly.js')));
    const samples = { baseline: [], optimized: [] };
    const params = {focusIso3:'IND',subject:'gdp_total',startYear:2024,endYear:2024};
    // Same handle, data, runtime and warm conditions; alternate execution order.
    await baseline.buildIndiaYearlyRows(db, params); await buildIndiaYearlyRows(db, params);
    for (let i=0; i<50; i++) for (const label of i%2 ? ['optimized','baseline'] : ['baseline','optimized']) {
      observed.reset();const start=performance.now();
      const value=await (label==='baseline' ? baseline.buildIndiaYearlyRows : buildIndiaYearlyRows)(db,params);
      samples[label].push({...observed.snapshot(),ms:performance.now()-start,fingerprint:createHash('sha256').update(stable(value)).digest('hex')});
    }
    const summary = rows => { const sorted=rows.map(r=>r.ms).sort((a,b)=>a-b);return {samples:rows.length,p50:sorted[25],p95:sorted[47],runs:rows}; };
    paired={workload:'bounded Overview',design:'same dataset/handle, 50 interleaved warm samples per implementation',baseline:summary(samples.baseline),optimized:summary(samples.optimized)};
  }
  const output = {sourceRevisionLabel:option('--label','working'),engine:process.versions,synthetic:true,transport:'local libsql disposable WAL file; client calls are NOT network round trips or billed usage',yearCount,countries:selected.length,indicators:Object.keys(METRICS).length,observations:rowCount,results,paired,plans:plans.rows,indexes:indexes.rows,rss:process.memoryUsage().rss};
  await fs.writeFile(option('--output',path.join(os.tmpdir(),'wdi-benchmark.json')),JSON.stringify(output,null,2));
  console.log(JSON.stringify({workloads:results.length,observations:rowCount,output:option('--output','OS temporary directory')}));
} finally { raw.close(); }
