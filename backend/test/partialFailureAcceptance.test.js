import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.WB_MAX_RETRIES = '0';
process.env.WB_RETRY_BASE_MS = '1';
const { startStubWorldBank, useStubBaseUrl } = await import('./helpers/stubWorldBank.js');

for (const scenario of ['single timeout', 'five HTTP 502 failures']) {
  test(`${scenario}: staged results never replace the published generation`, async () => {
    const stub = await startStubWorldBank({ inProcess: true });
    useStubBaseUrl(stub.baseUrl);
    const healthyFetch = globalThis.fetch;
    const { createMemoryDb } = await import('../src/db/index.js');
    const repository = await import('../src/db/repository.js');
    const { refreshData } = await import('../src/wb/ingest.js');
    const { METRICS } = await import('../src/config.js');
    const db = await createMemoryDb();
    try {
      const healthy = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'fixture-baseline' });
      assert.equal(healthy.status, 'success');
      const snapshot = async () => ({ observations: (await db.execute('SELECT * FROM observations ORDER BY country_id,indicator_id,year')).rows,
        generation: await repository.getDatasetState(db), success: await repository.getLastSuccessfulFetchTime(db) });
      const before = await snapshot();
      const failedKeys = scenario === 'single timeout' ? ['remittances_received'] : ['total_constant', 'inflation_cpi', 'fx_official', 'remittances_received', 'population_total'];
      const paths = failedKeys.map(key => '/country/all/indicator/' + METRICS[key].indicatorCode);
      globalThis.fetch = async (input, options) => {
        if (paths.some(path => String(input).includes(path))) {
          if (scenario === 'single timeout') throw new DOMException('Fixture upstream request timed out', 'TimeoutError');
          return new Response('Fixture World Bank unavailable', { status: 502 });
        }
        return healthyFetch(input, options);
      };
      const outcome = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'fixture-failure' });
      assert.equal(outcome.status, 'partial');
      assert.equal(outcome.rowsUpserted, 0);
      assert.deepEqual(outcome.perIndicator.filter(item => item.error).map(item => item.metricKey).sort(), failedKeys.sort());
      assert.equal(outcome.perIndicator.filter(item => !item.error).length, 20-failedKeys.length);
      assert.deepEqual(await snapshot(), before);
      const run = await repository.getLatestFetchRun(db, { status: null });
      assert.equal(run.status, 'partial');
      assert.equal(repository.parseProgressSummary(run.progress_summary).counts.failed, failedKeys.length);
      assert.equal(Number((await repository.refreshLockStatus(db)).locked), 0);
    } finally {
      globalThis.fetch = healthyFetch;
      db.close(); await stub.close();
    }
  });
}
