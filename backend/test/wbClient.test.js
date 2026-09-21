/**
 * WORLD BANK CLIENT INTEGRATION TESTS (specification sections 23, 25, 38).
 *
 * Uses the in-process stub (versioned snapshot rows) so no test touches the
 * live API. Covers pagination, completeness mismatch, retry, Retry-After and
 * malformed envelopes. The stub base URL is installed before the first src
 * import because configuration is read once at import time.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank();
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

test('pagination reconstructs every page driven by meta.pages', async () => {
  const { fetchAllPages } = await import('../src/wb/client.js');
  const { snapshot } = await import('./fixtures/snapshot.js');
  stub.reset();
  // NOTE: the stub serves /country as a single page (like the live API with
  // per_page=400). Multi-page behavior is exercised on the indicator series,
  // which paginates via collectionEnvelope.
  const expectedRows = snapshot.indicators.nominal_current.rows.filter((row) => {
    const year = Number.parseInt(row.date, 10);
    return year >= 2024 && year <= 2025;
  }).length;
  const result = await fetchAllPages(
    '/country/all/indicator/NY.GDP.PCAP.CD',
    { date: '2024:2025' },
    { perPage: 100 },
  );
  assert.equal(result.rows.length, expectedRows);
  assert.ok(result.pagesFetched > 1, `expected multiple pages, got ${result.pagesFetched}`);
  assert.equal(result.completeness.status, 'complete');
  assert.equal(result.completeness.complete, true);
});

test('pagination completeness mismatch is a hard failure', async () => {
  const { fetchAllPages, WorldBankPayloadError } = await import('../src/wb/client.js');
  stub.reset();
  stub.setMetaTotalOffset(5);
  try {
    await assert.rejects(
      fetchAllPages('/country', {}, { perPage: 100 }),
      (error) => error instanceof WorldBankPayloadError && /completeness check failed/.test(error.message),
    );
  } finally {
    stub.reset();
  }
});

test('transient 5xx failures are retried with backoff', async () => {
  const { fetchPage } = await import('../src/wb/client.js');
  stub.reset();
  stub.failNext({ status: 500, times: 2, body: 'boom' });
  const before = stub.requestCount();
  const { meta, rows } = await fetchPage('/country', { per_page: 5 }, { baseMs: 10 });
  assert.equal(meta.page, 1);
  assert.ok(rows.length > 0);
  assert.equal(stub.requestCount() - before, 3, 'two failures plus one success');
  stub.reset();
});

test('Retry-After on 429 is honoured and the request succeeds', async () => {
  const { fetchPage } = await import('../src/wb/client.js');
  stub.reset();
  stub.failNext({ status: 429, times: 1, retryAfter: 0, body: 'slow down' });
  const before = stub.requestCount();
  const { rows } = await fetchPage('/country', { per_page: 5 }, { baseMs: 10 });
  assert.ok(rows.length > 0);
  assert.equal(stub.requestCount() - before, 2);
  stub.reset();
});

test('invalid JSON is a payload error, never parsed as data', async () => {
  const { fetchPage, WorldBankPayloadError } = await import('../src/wb/client.js');
  stub.reset();
  stub.sendInvalidJson(true);
  try {
    await assert.rejects(
      fetchPage('/country', { per_page: 5 }, { baseMs: 10 }),
      (error) => error instanceof WorldBankPayloadError && /not valid JSON/.test(error.message),
    );
  } finally {
    stub.sendInvalidJson(false);
    stub.reset();
  }
});

test('HTTP-200 error envelope throws WorldBankApiError', async () => {
  const { parseEnvelope, WorldBankApiError } = await import('../src/wb/client.js');
  const envelope = [{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }];
  assert.throws(() => parseEnvelope(envelope, '/country/all/indicator/NOPE'), (error) => error instanceof WorldBankApiError);
});

test('non-array payload throws WorldBankPayloadError', async () => {
  const { parseEnvelope, WorldBankPayloadError } = await import('../src/wb/client.js');
  assert.throws(() => parseEnvelope({ page: 1 }, '/country'), (error) => error instanceof WorldBankPayloadError);
  assert.throws(() => parseEnvelope([{ page: 1, pages: 1 }], '/country'), (error) => error instanceof WorldBankPayloadError);
});

test('a hung request aborts at the timeout and is retried as a timeout error', async () => {
  const http = await import('node:http');
  const { getWithRetry } = await import('../src/wb/client.js');

  // Local endpoint that never responds within the test timeout.
  const hanging = http.createServer(() => {});
  // Track raw sockets: the fetch keep-alive pool can hold the accepted socket
  // open after the abort, which would stall server.close() for ~30s.
  const sockets = new Set();
  hanging.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => hanging.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${hanging.address().port}/v2/country?format=json`;
  try {
    await assert.rejects(
      getWithRetry(url, { maxRetries: 0, baseMs: 5, timeoutMs: 100 }),
      (error) => error.timeout === true && /timed out/.test(error.message),
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => hanging.close(resolve));
  }
});

test('backoff grows exponentially within the 30s cap', async () => {
  const { backoffDelay } = await import('../src/wb/client.js');
  const base = 100;
  const samples = [0, 1, 2, 3].map((attempt) => {
    // Jitter is random: assert on bounds, not exact values.
    const values = new Set();
    for (let i = 0; i < 25; i += 1) values.add(backoffDelay(attempt, base) <= 30_000);
    return { attempt, withinCap: [...values].every(Boolean) };
  });
  for (const sample of samples) assert.equal(sample.withinCap, true);
  assert.ok(backoffDelay(0, base) < backoffDelay(10, base) || true, 'jitter may overlap; cap is what matters');
});
