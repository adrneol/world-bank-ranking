process.env.PUBLIC_READ_API_ENABLED = '1';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { seedEdgeCaseDb } from './helpers/testDb.js';

test('an HTTP client can discover and retrieve bounded public evidence', async t => {
  const { db, repository } = await seedEdgeCaseDb();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: true });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const catalog = JSON.parse(await readFile(new URL('../../frontend/data-catalog.json', import.meta.url), 'utf8'));
  async function get(resource, params = {}, expected = 200, headers = {}) {
    const path = `/api/public/${resource}`;
    assert.ok(catalog.resources.some(([entry]) => entry === path));
    const start = performance.now();
    const response = await fetch(`${origin}${path}?${new URLSearchParams(params)}`, { headers });
    const raw = await response.text();
    assert.equal(response.status, expected, `${path}: ${raw.slice(0, 300)}`);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('x-auto-refresh'), null);
    if (expected === 429) assert.ok(Number(response.headers.get('retry-after')) > 0);
    if (expected === 200) t.diagnostic(`${resource}: ${Buffer.byteLength(raw)} bytes, ${(performance.now() - start).toFixed(1)} ms`);
    return JSON.parse(raw);
  }
  const before = await repository.getDatasetState(db);
  const indicator = 'nominal_current';
  const history = await get('focus/history', { country: 'IND', series: indicator, startYear: 2004, endYear: 2005 });
  assert.equal(history.source, 'World Bank WDI');
  assert.equal(history.series[0].unit, 'current US$');
  assert.deepEqual(history.series[0].points.map(point => point.value), [700.75, 800.125]);
  const ranking = await get('ranking', { indicator, year: 2005, country: 'IND', pageSize: 2 });
  assert.equal(ranking.rows.length, 2);
  assert.ok(ranking.total > ranking.rows.length);
  const compareParams = { indicator, entityA: 'country:IND', entityB: 'country:USA', yearA: 2004, yearB: 2005, operation: 'level' };
  const compare = await get('compare', compareParams);
  assert.equal(compare.available, true);
  assert.equal(compare.results.a.series.points[0].value, 700.75);
  assert.ok((await get('metadata')).methodology);
  for (const family of ['prices', 'trade', 'capital', 'fx', 'external', 'population']) {
    assert.ok((await get(`${family}/country-groups`)).supported);
  }
  await get('ranking', { indicator, year: '2005.5' }, 400);
  await get('ranking', { indicator: 'unsupported' }, 400);
  await get('ranking', { indicator, country: 'ZZZ' }, 400);
  await get('compare', { ...compareParams, operation: 'unsupported' }, 400);
  await get('focus/history', { country: 'IND', series: indicator, startYear: 2005, endYear: 2004 }, 400);
  await get('focus/history', { country: 'IND', series: Array.from({ length: 9 }, (_, i) => `series${i}`).join(','), startYear: 2004, endYear: 2005 }, 400);
  await get('observations', { indicator }, 400);
  const unknown = await fetch(`${origin}/api/public/data/refresh`, { method: 'POST' });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await repository.getDatasetState(db), before);
  assert.equal(await repository.getLatestFetchRun(db), null);

  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 60000);
  for (let request = 0; request < 60; request += 1) {
    const response = await fetch(`${origin}/api/public/metadata`);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  await get('metadata', {}, 429, { 'x-forwarded-for': '192.0.2.23' });
  assert.equal((await fetch(origin + '/api/metadata?readOnly=1')).status, 429, 'legacy route shares the read budget');
  for (const path of ['/api/india/gdp-ranking', '/api/integrity', '/api/geo/country']) {
    assert.equal((await fetch(origin + path)).status, 429, `${path} cannot bypass the read budget`);
  }
});
