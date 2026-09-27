/**
 * PHASE-1 R-02 TESTS: bounded frontend requests.
 *
 * Imports the real frontend API client by relative path (it is dependency-
 * free: no JSX, and import.meta.env access is Vite-safe-guarded) and points
 * it at a stub HTTP server. A hung backend must produce a distinct retryable
 * TIMEOUT ApiError — never an eternally pending promise — while caller
 * aborts keep native AbortError semantics and fast responses are unaffected.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';

let stub = null;
let stubBase = null;

test.before(async () => {
  stub = http.createServer((req, res) => {
    if (req.url.startsWith('/api/data-status')) {
      // Slow/cold-starting backend: responds, but only after 400 ms.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }, 400);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ years: [2000], minYear: 2000, maxYear: 2000 }));
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubBase = `http://127.0.0.1:${stub.address().port}`;

  const client = await import('../../frontend/src/api/client.js');
  client.setApiBaseUrl(stubBase);
});

test.after(async () => {
  const client = await import('../../frontend/src/api/client.js');
  client.setApiBaseUrl(null);
  await new Promise((resolve) => stub.close(resolve));
});

test('a hung backend produces a retryable TIMEOUT error, not a pending promise', async () => {
  const { api } = await import('../../frontend/src/api/client.js');
  await assert.rejects(api.dataStatus({ timeoutMs: 50 }), (error) => {
    assert.equal(error?.code, 'TIMEOUT');
    assert.match(error?.message ?? '', /longer than expected/);
    return true;
  });
});

test('a fast backend is unaffected by the bound', async () => {
  const { api } = await import('../../frontend/src/api/client.js');
  const body = await api.years({ timeoutMs: 5000 });
  assert.deepEqual(body.years, [2000]);
});

test('caller aborts keep AbortError semantics (no TIMEOUT masquerade)', async () => {
  const { api } = await import('../../frontend/src/api/client.js');
  const controller = new AbortController();
  const pending = assert.rejects(api.dataStatus({ signal: controller.signal, timeoutMs: 5000 }), (error) => {
    assert.equal(error?.name, 'AbortError');
    return true;
  });
  controller.abort();
  await pending;
});
