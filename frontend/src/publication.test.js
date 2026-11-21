import { expect, it } from 'vitest';
import { respondPublication } from '../server/publication.js';
import catalog from '../data-catalog.json';

const template = '<html><head><!-- public-metadata-start --><!-- public-metadata-end --></head><body><!-- public-body-start --><div id="root"></div><!-- public-body-end --></body></html>';
async function render(resource, capability) {
  const headers = {};
  const response = { statusCode: 200, setHeader: (key, value) => { headers[key] = value; }, end(body) { this.body = body; } };
  await respondPublication({ method: 'GET' }, response, { resource, backend: 'http://127.0.0.1:3001', origin: null, catalog,
    template: async () => template, fetcher: async () => { if (capability instanceof Error) throw capability; return { ok: true, json: async () => capability }; } });
  return { ...response, headers };
}
it('serves complete crawler-readable documents only after explicit backend confirmation', async () => {
  const response = await render('docs', { publicReadApiEnabled: true });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('<h1>Public Economic Data API</h1>');
  expect(response.body).toContain('Endpoint reference');
  expect(response.body).toContain('/data-catalog.json');
  expect(response.body).not.toContain('rel="canonical"');
  expect(JSON.parse((await render('catalog', { publicReadApiEnabled: true })).body).resources).toHaveLength(30);
});
it.each([{ publicReadApiEnabled: false }, {}, { publicReadApiEnabled: 'true' }, new Error('offline')])(
  'fails closed with a readable response and no catalog advertisement for %j', async capability => {
    const response = await render('docs', capability);
    expect(response.statusCode).toBe(capability.publicReadApiEnabled === false ? 404 : 503);
    expect(response.body).toContain('Public API documentation unavailable');
    expect(response.body).not.toContain('href="/data-catalog.json"');
    expect(response.body).not.toContain('href="/public-data/"');
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.headers['Vercel-CDN-Cache-Control']).toBe('no-store');
    expect((await render('catalog', capability)).statusCode).toBe(response.statusCode);
  },
);
