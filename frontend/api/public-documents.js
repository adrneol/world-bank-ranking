import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { respondPublication } from '../server/publication.js';
import { siteOrigin } from '../server/documentHtml.js';

const read = promisify(readFile);
const catalog = JSON.parse(readFileSync(new URL('../data-catalog.json', import.meta.url), 'utf8'));
export default async function documents(req, res) {
  try {
    await respondPublication(req, res, {
      resource: req.query?.resource,
      backend: process.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, ''),
      origin: siteOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null),
      catalog,
      template: () => read(join(process.cwd(), 'dist', 'index.html'), 'utf8'),
    });
  } catch {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Public API documentation is temporarily unavailable. Return to /.');
  }
}
