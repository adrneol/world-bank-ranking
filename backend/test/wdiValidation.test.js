import './isolation.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { seriesRows } from './fixtures/snapshot.js';

process.env.WB_RETRY_BASE_MS = '1';

const key = 'nominal_current';
const code = 'NY.GDP.PCAP.CD';
const years = { startYear: 2024, endYear: 2025 };
let mutate;
let rawResponse;
let stub;
let refreshData;
let createMemoryDb;
let repo;

test.before(async () => {
  stub = await startStubWorldBank({
    inProcess: true,
    responseFor: (request) => mutate?.(request),
  });
  useStubBaseUrl(stub.baseUrl);
  ({ refreshData } = await import('../src/wb/ingest.js'));
  ({ createMemoryDb } = await import('../src/db/index.js'));
  repo = await import('../src/db/repository.js');
  rawResponse = globalThis.fetch;
});

test.after(async () => { await stub.close(); });
test.afterEach(() => {
  mutate = undefined;
  globalThis.fetch = rawResponse;
  stub.reset();
});

const series = ({ path }) => path.endsWith('/country/all/indicator/' + code);
const metadata = ({ path }) => path.endsWith('/source/2/indicator/' + code);

async function state(db) {
  const result = await db.execute('SELECT * FROM observations ORDER BY indicator_id, country_id, year');
  return {
    observations: result.rows,
    generation: await repo.getDatasetState(db),
    success: await repo.getLatestFetchRun(db),
  };
}

const run = (db, extra = {}) => refreshData({ db, ...years, indicators: [key], trigger: 'test', ...extra });

test('WDI source, numeric representation and explicit missingness survive publication', async () => {
  const db = await createMemoryDb();
  try {
    mutate = (request) => {
      if (series(request)) {
        assert.equal(request.params.source, '2');
        const [header, rows] = request.payload;
        const values = new Map([['IND', ' -2.50e+2 '], ['USA', 0], ['DEU', null], ['PAK', undefined]]);
        return [header, rows.map((row) => row.date === '2025' && values.has(row.countryiso3code)
          ? { ...row, value: values.get(row.countryiso3code) } : row)];
      }
      if (metadata(request)) {
        const [header, rows] = request.payload;
        return [{ ...header, sourceid: undefined }, rows];
      }
    };
    const summary = await run(db);
    assert.equal(summary.status, 'success');
    assert.ok(stub.state.requests.some(metadata));
    const indicator = await repo.getIndicatorByMetricKey(db, key);
    const ind = await repo.getObservation(db, 'IND', indicator.id, 2025);
    const usa = await repo.getObservation(db, 'USA', indicator.id, 2025);
    assert.equal(ind.value, -250);
    assert.equal(ind.value_raw, '-2.50e+2');
    assert.equal(ind.wb_last_updated, '2026-07-13');
    assert.equal(usa.value, 0);
    assert.equal(await repo.getObservation(db, 'DEU', indicator.id, 2025), null);
    assert.equal(await repo.getObservation(db, 'PAK', indicator.id, 2025), null);
  } finally { db.close(); }
});

const invalidRows = [
  ['wrong indicator', { indicator: { id: 'SP.POP.TOTL' } }, /indicator identity/],
  ['bad economy code', { countryiso3code: 123 }, /economy code/],
  ['different source economy', { country: { id: 'ZZ' } }, /mismatched economy identity/],
  ['blank ISO3 for known economy', { countryiso3code: '', country: { id: 'IN' } }, /missing economy code for a ranked economy/],
  ['partial year', { date: '2025x' }, /annual year/],
  ['out-of-range year', { date: '2026' }, /outside requested range/],
  ['blank value', { value: ' ' }, /numeric value/],
  ['boolean value', { value: false }, /numeric value/],
  ['non-finite value', { value: '1e999' }, /numeric value/],
  ['nondecimal value', { value: '0x20' }, /numeric value/],
];

test('malformed or unverifiable candidates preserve the exact committed generation', async (t) => {
  const db = await createMemoryDb();
  try {
    assert.equal((await run(db)).status, 'success');
    const before = await state(db);
    const cases = invalidRows.map(([name, fields, error]) => [name, (req) => {
      if (!series(req)) return;
      const [header, rows] = req.payload;
      return [header, [{ ...rows[0], ...fields }, ...rows.slice(1)]];
    }, error]);
    cases.push(
      ['source mismatch', (req) => series(req) ? [{ ...req.payload[0], sourceid: '11' }, req.payload[1]] : undefined, /source in page/],
      ['wrong metadata ID', (req) => metadata(req) ? [req.payload[0], [{ ...req.payload[1][0], id: 'SP.POP.TOTL' }]] : undefined, /indicator metadata/],
      ['wrong metadata source', (req) => metadata(req) ? [req.payload[0], [{ ...req.payload[1][0], source: { id: 11 } }]] : undefined, /source in indicator metadata/],
      ['missing metadata', (req) => metadata(req) ? [{ ...req.payload[0], total: 0 }, []] : undefined, /metadata is missing/],
      ['duplicate observation', (req) => series(req) ? [req.payload[0], [req.payload[1][1], ...req.payload[1].slice(1)]] : undefined, /duplicate observation/],
      ['invalid vintage', (req) => series(req) ? [{ ...req.payload[0], lastupdated: '2026-02-31' }, req.payload[1]] : undefined, /Invalid World Bank vintage/],
      ['older vintage', (req) => series(req) ? [{ ...req.payload[0], lastupdated: '2026-07-12' }, req.payload[1]] : undefined, /older than the committed/],
    );
    cases.push(
      ['duplicate country metadata', (req) => req.path === '/v2/country'
        ? [req.payload[0], [req.payload[1][1], ...req.payload[1].slice(1)]] : undefined, /Duplicate World Bank country metadata/],
      ['metadata HTTP outage', () => undefined, /HTTP 503 from World Bank/],
    );
    for (const [name, transform, error] of cases) {
      await t.test(name, async () => {
        mutate = transform;
        if (name === 'metadata HTTP outage') {
          stub.failNextMatching({ status: 503, times: 50, substring: '/source/2/indicator/' + code });
        }
        try {
          await assert.rejects(run(db), error);
        } finally {
          stub.reset();
        }
        assert.deepEqual(await state(db), before);
        assert.equal((await repo.refreshLockStatus(db)).locked, 0);
      });
    }
  } finally { db.close(); }
});

test('pagination rejects first, intermediate, last-page and mixed-release failures', async (t) => {
  const { fetchIndicatorSeries } = await import('../src/wb/client.js');
  const db = await createMemoryDb();
  try {
    assert.equal((await run(db)).status, 'success');
    const before = await state(db);
    const cases = [
      ['first-page number', 1, (header, rows) => [{ ...header, page: 2 }, rows], /pagination completeness/],
      ['intermediate page repeats', 2, (header, rows) => [{ ...header, page: 1 }, rows], /pagination completeness/],
      ['intermediate vintage differs', 2, (header, rows) => [{ ...header, lastupdated: '2026-07-14' }, rows], /Inconsistent World Bank vintage/],
      ['second page has wrong source', 2, (header, rows) => [{ ...header, sourceid: 11 }, rows], /source in page/],
      ['last page has wrong indicator', 3, (header, rows) => [header, [{ ...rows[0], indicator: { id: 'SP.POP.TOTL' } }, rows[1]]], /indicator identity/],
      ['last page is truncated', 3, (header, rows) => [header, rows.slice(1)], /pagination completeness/],
    ];
    for (const [name, page, change, error] of cases) {
      await t.test(name, async () => {
        mutate = (req) => {
          if (!series(req)) return;
          const [header] = req.payload;
          const small = seriesRows(key, 2025).slice(0, 6);
          const selected = Number(req.params.page);
          const candidate = { ...header, page: selected, pages: 3, per_page: 2, total: 6 };
          const pageRows = small.slice((selected - 1) * 2, selected * 2);
          return selected === page ? change(candidate, pageRows) : [candidate, pageRows];
        };
        await assert.rejects(run(db), error);
        assert.deepEqual(await state(db), before);
      });
    }
    mutate = undefined;
    const result = await fetchIndicatorSeries(code, 2024, 2025, { perPage: 100 });
    assert.ok(result.pagesFetched > 1);
    assert.equal(result.rows.length, result.declaredTotal);
  } finally { db.close(); }
});

test('staging, begin, mid-publish and commit rejection roll back, while a lost successful commit response is verified', async (t) => {
  const { getCachedAvailableYears } = await import('../src/services/yearsCache.js');
  for (const failure of ['staging', 'staging-truncation', 'begin', 'middle', 'commit', 'lost-commit-response', 'unverified-commit']) {
    await t.test(failure, async () => {
      const db = await createMemoryDb();
      const originalTransaction = db.transaction.bind(db);
      const originalWrite = fs.promises.writeFile;
      const originalExecute = db.execute.bind(db);
      try {
        assert.equal((await run(db)).status, 'success');
        const before = await state(db);
        const beforeYears = await getCachedAvailableYears(db);
        mutate = (req) => {
          if (!series(req)) return;
          const [header, rows] = req.payload;
          const newest = rows.find((row) => row.countryiso3code === 'IND' && row.date === '2025');
          return [{ ...header, total: header.total + 1, lastupdated: '2026-07-14' },
            [...rows, { ...newest, date: '2026', value: newest.value + 1 }]];
        };
        let injected = false;
        const fail = () => { injected = true; throw new Error('injected ' + failure); };
        if (failure.startsWith('staging')) {
          fs.promises.writeFile = async (filename, ...args) => {
            if (String(filename).startsWith(path.join(os.tmpdir(), 'wb-refresh-staging-'))) {
              if (failure === 'staging') fail();
              injected = true;
              return originalWrite(filename, '', 'utf8');
            }
            return originalWrite(filename, ...args);
          };
        } else {
          db.transaction = async (...args) => {
            if (!injected && failure === 'begin') fail();
            const tx = await originalTransaction(...args);
            if (injected) return tx;
            if (failure === 'middle') {
              const batch = tx.batch.bind(tx);
              tx.batch = async (...input) => {
                if (!injected && input[0].some((statement) => /INSERT INTO observations/.test(statement.sql))) fail();
                return batch(...input);
              };
            } else {
              const commit = tx.commit.bind(tx);
              tx.commit = async () => {
                if (failure === 'lost-commit-response' || failure === 'unverified-commit') await commit();
                if (failure === 'unverified-commit') {
                  db.execute = (stmt) => {
                    if (stmt.sql?.includes('SELECT status FROM fetch_runs WHERE id')) throw new Error('injected verification outage');
                    return originalExecute(stmt);
                  };
                }
                fail();
              };
            }
            return tx;
          };
        }
        if (failure === 'lost-commit-response') {
          assert.equal((await run(db, { endYear: 2026 })).status, 'success');
          const after = await state(db);
          assert.equal(after.success.status, 'success');
          assert.equal(after.generation.contentVersion, before.generation.contentVersion + 1);
          assert.equal((await getCachedAvailableYears(db)).years.at(-1), 2026);
        } else if (failure === 'unverified-commit') {
          await assert.rejects(run(db, { endYear: 2026 }), (error) =>
            error.code === 'PUBLICATION_OUTCOME_UNKNOWN' && error.datasetPreserved === null);
          db.execute = originalExecute;
          assert.equal((await repo.getLatestFetchRun(db, { status: null })).status, 'success');
          assert.equal((await getCachedAvailableYears(db)).years.at(-1), 2026);
        } else {
          await assert.rejects(run(db, { endYear: 2026 }), failure === 'staging-truncation'
            ? /staging content changed/ : new RegExp('injected ' + failure));
          assert.deepEqual(await state(db), before);
          assert.deepEqual(await getCachedAvailableYears(db), beforeYears);
        }
        assert.equal(injected, true);
        assert.equal((await repo.refreshLockStatus(db)).locked, 0);
      } finally {
        db.transaction = originalTransaction;
        db.execute = originalExecute;
        fs.promises.writeFile = originalWrite;
        db.close();
      }
    });
  }
});



test('reconciliation cannot withdraw an existing primary key', async () => {
  const db = await createMemoryDb();
  try {
    assert.equal((await run(db)).status, 'success');
    const before = await state(db);
    mutate = (req) => {
      if (!series(req)) return;
      const [header, rows] = req.payload;
      const revised = rows.map((row) => row.date === '2025' && row.countryiso3code === 'IND'
        ? { ...row, value: null } : row);
      return [{ ...header, lastupdated: '2026-07-14' }, revised];
    };
    await assert.rejects(run(db, { preserveObservationKeys: true }), /would remove a committed observation/);
    assert.deepEqual(await state(db), before);
  } finally { db.close(); }
});
