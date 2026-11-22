import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { publicationFailure, publicationResource, respondPublication } from '../server/publication.js';
import { siteOrigin } from '../server/documentHtml.js';

const read = promisify(readFile);
const catalog = JSON.parse(readFileSync(new URL('../data-catalog.json', import.meta.url), 'utf8'));
// A statically traceable module-relative URL works independently of function cwd.
// vercel.json also explicitly includes this generated build asset.
export function createDocumentHandler({ loadTemplate = () => read(new URL('../dist/index.html', import.meta.url), 'utf8'), fetcher } = {}) {
return async function documents(req, res) {
  const resource = req.query?.resource ?? publicationResource(new URL(req.url ?? '/', 'https://local.invalid').pathname);
  try {
    await respondPublication(req, res, {
      resource,
      backend: process.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, ''),
      origin: siteOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null),
      catalog,
      template: loadTemplate,
      fetcher,
    });
  } catch {
    publicationFailure(req, res, { resource, rendering: true });
  }
};
}
export default createDocumentHandler();
