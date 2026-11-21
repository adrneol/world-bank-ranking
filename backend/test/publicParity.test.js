import './isolation.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { closeDb } from '../src/db/index.js';
import { seedConfiguredDatabase } from './helpers/configuredDb.js';

test('every published research resource is retrievable with its analytical contract', async t => {
  const db = await seedConfiguredDatabase();
  const { createApp } = await import('../src/server.js');
  const server = await new Promise(resolve => {
    const listener = createApp({ db, autoRefresh: false }).listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); closeDb(); });
  const catalog = JSON.parse(await readFile(new URL('../../frontend/data-catalog.json', import.meta.url), 'utf8'));
  const base = `http://127.0.0.1:${server.address().port}`;
  const common = { country: 'IND', year: 2024, yearA: 2004, yearB: 2024, startYear: 2004, endYear: 2024 };
  const parameters = {
    'observations': { indicator: 'nominal_current' },
    'focus/yearly': { subject: 'gdp_total' },
    'focus/history': { series: 'total_constant,inflation_cpi' },
    'ranking': { indicator: 'nominal_current', pageSize: 2 },
    'ranking/verify': { indicator: 'nominal_current' },
    'yoy-ranking': { indicator: 'nominal_current', pageSize: 2 },
    'yoy-ranking/verify': { indicator: 'nominal_current' },
    'compare': { indicator: 'total_current', entityA: 'country:IND', entityB: 'group:USA,DEU', operation: 'level' },
    'groups/evaluate': { indicator: 'total_current', members: 'IND,USA' },
    'comparison/level': { indicator: 'total_constant', mode: 'yoy' },
    'periods/summary': { indicator: 'exports_current', operation: 'SUM' },
    'movement/prices': { indicator: 'inflation_cpi' },
    'movement/trade': { indicator: 'exports_current' },
    'movement/capital': { indicator: 'fdi_inflows' },
    'movement/fx': { indicator: 'fx_official' },
    'movement/external': { indicator: 'current_account' },
    'movement/population': { indicator: 'population_total' },
    'coverage': { indicator: 'nominal_current' },
  };
  const before = await db.execute('SELECT COUNT(*) AS n FROM observations');
  const beforeRuns = await db.execute('SELECT COUNT(*) AS n FROM fetch_runs');
  for (const [path] of catalog.resources) {
    const resource = path.replace('/api/public/', '');
    const response = await fetch(`${base}${path}?${new URLSearchParams({ ...common, ...parameters[resource] })}`);
    const raw = await response.text();
    assert.equal(response.status, 200, `${path}: ${raw.slice(0, 250)}`);
    const body = JSON.parse(raw);
    assert.ok(body.methodology || body.source === 'World Bank WDI', path + ' retains provenance');
    assert.equal(response.headers.get('x-auto-refresh'), null);
    if (resource === 'focus/history') {
      assert.equal(body.series.find(item => item.id === 'total_constant').unit, 'constant 2015 US$');
      assert.equal(body.series.find(item => item.id === 'inflation_cpi').unit, 'annual %');
    }
    if (resource === 'compare') assert.ok(body.results.a && body.results.b);
    t.diagnostic(`${path}: 200 JSON, ${Buffer.byteLength(raw)} bytes`);
  }
  assert.deepEqual((await db.execute('SELECT COUNT(*) AS n FROM observations')).rows, before.rows);
  assert.deepEqual((await db.execute('SELECT COUNT(*) AS n FROM fetch_runs')).rows, beforeRuns.rows);
});
