/**
 * DEFAULT-COUNTRY GEOLOCATION TESTS (Phase 3, Part B).
 *
 * GET /api/geo/country is a UX default only: it resolves the requester's
 * eligible ISO3 once through a keyless provider, validated against stored
 * World Bank metadata. Every failure mode resolves to null with HTTP 200 —
 * geolocation can never break the bootstrap. No test touches the live World
 * Bank API or the real geolocation provider (a local stub stands in).
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

// --- Local provider stub (routes by path so each test controls the reply) ---
let providerHits = [];
let providerMode = 'us';

const provider = http.createServer((req, res) => {
  providerHits.push(req.url);
  const send = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  if (providerMode === '500') return send(500, { message: 'down' });
  if (providerMode === 'malformed') return send(200, { hello: 'world' });
  if (providerMode === 'unknown') return send(200, { country_code: 'XX' });
  if (providerMode === 'aggregate') return send(200, { country_code: 'XA' });
  return send(200, { country_code: 'US' });
});

test.before(async () => {
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${provider.address().port}`;
  process.env.GEO_PROVIDER_URL = `${base}/geo/{ip}`;
  process.env.GEO_TIMEOUT_MS = '1000';
});

test.after(async () => {
  await new Promise((resolve) => provider.close(resolve));
});

function seedDb(db) {
  const countries = [
    { id: 'USA', iso2: 'US', iso3: 'USA', name: 'United States', isAggregate: false },
    { id: 'IND', iso2: 'IN', iso3: 'IND', name: 'India', isAggregate: false },
    { id: 'DEU', iso2: 'DE', iso3: 'DEU', name: 'Germany', isAggregate: false },
    // Aggregate-like row: a matching iso2 must still resolve to null.
    { id: 'XAGG', iso2: 'XA', iso3: 'XA', name: 'Aggregate X', isAggregate: true },
  ];
  return { countries };
}

async function seedAsync() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { upsertCountry } = await import('../src/db/repository.js');
  const db = createMemoryDb();
  for (const row of seedDb(db).countries) upsertCountry(db, row);
  return db;
}

async function serve(db) {
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: async (path, headers = {}) => {
      const res = await fetch(`${base}${path}`, { headers });
      return { status: res.status, body: await res.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// --- Unit: IP extraction and routability ---

test('client IP prefers X-Forwarded-For and normalizes mapped addresses', async () => {
  const { clientIpFromRequest, resetGeoCache } = await import('../src/services/geo.js');
  resetGeoCache();
  assert.equal(clientIpFromRequest({ headers: { 'x-forwarded-for': '8.8.8.8, 10.0.0.1' } }), '8.8.8.8');
  assert.equal(clientIpFromRequest({ headers: {}, socket: { remoteAddress: '::ffff:9.9.9.9' } }), '9.9.9.9');
  assert.equal(clientIpFromRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientIpFromRequest({ headers: {} }), null);
  assert.equal(clientIpFromRequest({ headers: { 'x-forwarded-for': 'unknown' } }), null);
});

test('private, loopback and reserved addresses are never routable', async () => {
  const { isRoutableIp } = await import('../src/services/geo.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '172.31.255.1', '192.168.0.1', '169.254.10.20', '0.0.0.0', '::1', '::', 'fe80::1', 'fc00::1', 'not-an-ip', '']) {
    assert.equal(isRoutableIp(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.7', '2001:4860:4860::8888']) {
    assert.equal(isRoutableIp(ip), true, ip);
  }
});

// --- HTTP: contract ---

test('public IP resolves to an eligible ISO3 via the provider', async () => {
  const { resetGeoCache } = await import('../src/services/geo.js');
  resetGeoCache();
  providerMode = 'us';
  providerHits = [];
  const db = await seedAsync();
  const api = await serve(db);
  try {
    const res = await api.get('/api/geo/country', { 'x-forwarded-for': '8.8.8.8' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { iso3: 'USA', source: 'geoip' });
    assert.ok(providerHits.some((u) => u.includes('8.8.8.8')), 'provider receives the client IP');
  } finally {
    await api.close();
    db.close();
  }
});

test('private client IP short-circuits to fallback without a provider call', async () => {
  const { resetGeoCache } = await import('../src/services/geo.js');
  resetGeoCache();
  providerMode = 'us';
  providerHits = [];
  const db = await seedAsync();
  const api = await serve(db);
  try {
    const res = await api.get('/api/geo/country', { 'x-forwarded-for': '10.9.9.9' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { iso3: null, source: 'fallback' });
    assert.equal(providerHits.length, 0, 'no outbound call for non-routable IPs');
  } finally {
    await api.close();
    db.close();
  }
});

test('unknown, aggregate and malformed provider results fall back safely', async () => {
  const { resetGeoCache } = await import('../src/services/geo.js');
  const db = await seedAsync();
  const api = await serve(db);
  try {
    for (const mode of ['unknown', 'aggregate', 'malformed', '500']) {
      resetGeoCache();
      providerMode = mode;
      // eslint-disable-next-line no-await-in-loop
      const res = await api.get('/api/geo/country', { 'x-forwarded-for': '8.8.4.4' });
      assert.equal(res.status, 200, mode);
      assert.deepEqual(res.body, { iso3: null, source: 'fallback' }, mode);
    }
  } finally {
    await api.close();
    db.close();
  }
});

test('repeated lookups share one provider call (bounded cache)', async () => {
  const { resetGeoCache } = await import('../src/services/geo.js');
  resetGeoCache();
  providerMode = 'us';
  providerHits = [];
  const db = await seedAsync();
  const api = await serve(db);
  try {
    await api.get('/api/geo/country', { 'x-forwarded-for': '1.1.1.1' });
    await api.get('/api/geo/country', { 'x-forwarded-for': '1.1.1.1' });
    assert.equal(providerHits.length, 1, 'second lookup served from cache');
  } finally {
    await api.close();
    db.close();
  }
});
