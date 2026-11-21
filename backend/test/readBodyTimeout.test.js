import './isolation.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { api, setApiBaseUrl } from '../../frontend/src/api/client.js';

test('read timeout remains active while a response body is incomplete', async t => {
  let closed = false;
  const server = createServer((_req, res) => {
    res.once('close', () => { closed = true; });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"publicReadApiEnabled":'); // Headers arrived, but the body never completes.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  setApiBaseUrl('http://127.0.0.1:' + server.address().port);
  t.after(async () => { setApiBaseUrl(null); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const result = await Promise.race([
    api.capabilities({ timeoutMs: 60 }).then(() => 'unexpected success', error => error.code),
    new Promise(resolve => setTimeout(() => resolve('still waiting for body'), 500)),
  ]);
  assert.equal(result, 'TIMEOUT');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(closed, true, 'the timed-out body stream is aborted, not left running');
});
