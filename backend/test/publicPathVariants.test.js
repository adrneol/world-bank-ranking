import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { seedEdgeCaseDb } from './helpers/testDb.js';

async function serve(t) {
  const { db, repository } = await seedEdgeCaseDb();
  const { createApp } = await import('../src/server.js');
  const server = await new Promise(resolve => { const listener = createApp({ db, autoRefresh: false }).listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  return { db, repository, origin: 'http://127.0.0.1:' + server.address().port };
}
test('case and trailing-slash aliases retain passive status behavior', async t => {
  const { db, repository, origin } = await serve(t);
  const before = await repository.getDatasetState(db);
  const response = await fetch(origin + '/API/PUBLIC/DATA-STATUS/');
  assert.equal(response.status, 200); await response.arrayBuffer();
  assert.deepEqual(await repository.getDatasetState(db), before, 'public variants must not persist integrity or repair state');
});
test('case and trailing-slash variants share the real read budget', async t => {
  const { origin } = await serve(t);
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  for (let request = 0; request < 60; request += 1) {
    const response = await fetch(origin + '/API/PUBLIC/METADATA/');
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  for (const path of ['/api/public/metadata', '/API/PUBLIC/METADATA/', '/API/METADATA/']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 429, path); await response.arrayBuffer();
  }
});
test('implicit HEAD routes are charged to the same read budget', async t => {
  const { origin } = await serve(t);
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  for (let request = 0; request < 60; request += 1) {
    const response = await fetch(origin + '/api/public/metadata/', { method: 'HEAD' });
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  const response = await fetch(origin + '/api/metadata');
  assert.equal(response.status, 429); await response.arrayBuffer();
});
