import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
test('public API publication is strictly enabled and independent of human routes', async () => {
  for (const value of [undefined, '', '0', 'true', 'yes', 'unexpected', '1']) {
    const script = `
      await import('./src/config.js');
      const { createMemoryDb } = await import('./src/db/index.js');
      const { createApp, setServiceReadiness } = await import('./src/server.js');
      const db = await createMemoryDb();
      const server = await new Promise(resolve => {
        const listener = createApp({ db, autoRefresh: false }).listen(0, '127.0.0.1', () => resolve(listener));
      });
      const origin = 'http://127.0.0.1:' + server.address().port;
      const human = await fetch(origin + '/api/countries?readOnly=1');
      let statements = 0;
      const execute = db.execute.bind(db);
      db.execute = (...args) => { statements += 1; return execute(...args); };
      const published = await fetch(origin + '/api/public/countries');
      const status = published.status;
      await human.arrayBuffer();
      await published.arrayBuffer();
      const disabledUntouched = status !== 404 || statements === 0;
      statements = 0;
      setServiceReadiness({ ready: false, state: 'starting' });
      const capability = await fetch(origin + '/api/capabilities');
      const cacheSafe = capability.headers.get('cache-control').includes('no-store');
      const body = await capability.json();
      const cheap = statements === 0;
      const unreadyAlias = await fetch(origin + '/api/public/countries');
      await unreadyAlias.arrayBuffer();
      await new Promise(resolve => server.close(resolve));
      db.close();
      console.log(JSON.stringify({ human: human.status, status, untouched: disabledUntouched, capability: body, cheap, cacheSafe, unreadyStatus: unreadyAlias.status }));
    `;
    const env = { ...process.env, NODE_ENV: 'test' };
    if (value === undefined) delete env.PUBLIC_READ_API_ENABLED;
    else env.PUBLIC_READ_API_ENABLED = value;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { env, cwd: new URL('../', import.meta.url) });
    assert.deepEqual(JSON.parse(stdout.trim()), { human: 200, status: value === '1' ? 200 : 404, untouched: true,
      capability: { publicReadApiEnabled: value === '1' }, cheap: true, cacheSafe: true, unreadyStatus: value === '1' ? 503 : 404 }, String(value));
  }
});
