import assert from 'node:assert/strict';
import test from 'node:test';
import location from '../../frontend/api/location.js';
import { locationEndpoint } from '../../frontend/server/locationPlugin.js';

test('frontend geolocation accepts only a valid country on the intended hosting runtime', () => {
  const previous = process.env.VERCEL;
  try {
    for (const [runtime, country, expected] of [['', 'JP', null], ['1', 'JP', 'JP'], ['1', ['US', 'GB'], null], ['1', 'unknown', null]]) {
      process.env.VERCEL = runtime;
      let result;
      let code;
      const response = { setHeader() {}, status(value) { code = value; return this; }, json(value) { result = value; } };
      location({ method: 'GET', headers: { 'x-vercel-ip-country': country } }, response);
      assert.equal(code, 200);
      assert.equal(result.iso2, expected);
    }
  } finally {
    if (previous == null) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});

test('local Vite location handler ignores supplied geo headers even in a Vercel-labelled process', () => {
  const previous = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    let middleware;
    locationEndpoint().configureServer({ middlewares: { use(handler) { middleware = handler; } } });
    const headers = {};
    let body;
    const response = { setHeader(name, value) { headers[name] = value; }, end(value) { body = JSON.parse(value); } };
    middleware({ url: '/api/location', method: 'GET', headers: { 'x-vercel-ip-country': 'JP' } }, response, () => assert.fail('route was proxied'));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(body, { iso2: null, source: 'unavailable' });
    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.equal(headers['CDN-Cache-Control'], 'no-store');
    assert.equal(headers['Vercel-CDN-Cache-Control'], 'no-store');
  } finally {
    if (previous == null) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
