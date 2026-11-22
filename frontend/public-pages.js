import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pagePath } from './src/config/publicPages.js';
import { humanPages, publicPageHtml, siteOrigin } from './server/documentHtml.js';
import { publicationFailure, publicationResource, respondPublication } from './server/publication.js';

export { publicPageHtml } from './server/documentHtml.js';

export function publicDocuments({ origin, catalog }) {
  let outDir, root, backend, building;
  const base = siteOrigin(origin);
  const middleware = template => async (req, res, next) => {
    const resource = publicationResource(new URL(req.url, 'http://localhost').pathname);
    if (!resource) return next();
    try { await respondPublication(req, res, { resource, backend, origin: base, catalog, template }); }
    catch { publicationFailure(req, res, { resource, rendering: true }); }
  };
  return {
    name: 'public-research-documents',
    configResolved(config) {
      root = config.root;
      building = config.command === 'build';
      outDir = join(root, config.build.outDir);
      backend = config.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || config.server.proxy?.['/api']?.target || 'http://localhost:3001';
    },
    configureServer(server) {
      server.middlewares.use(middleware(async () => (await readFile(join(root, 'index.html'), 'utf8')).replace('</head>', '<link rel="stylesheet" href="/src/index.css"></head>')));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(() => readFile(join(outDir, 'index.html'), 'utf8')));
    },
    async closeBundle() {
      if (!building) return;
      const template = await readFile(join(outDir, 'index.html'), 'utf8');
      for (const view of Object.keys(humanPages)) {
        const folder = join(outDir, pagePath(view));
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'index.html'), publicPageHtml(template, view, base));
      }
      await rm(join(outDir, 'data-catalog.json'), { force: true });
      await rm(join(outDir, 'sitemap.xml'), { force: true });
      await rm(join(outDir, 'public-data', 'index.html'), { force: true });
      const robots = ['User-agent: Googlebot', 'User-agent: OAI-SearchBot', 'User-agent: ChatGPT-User', 'Allow: /', '',
        'User-agent: GPTBot', 'Disallow: /', '', 'User-agent: *', 'Disallow: /', '', ...(base ? [`Sitemap: ${base}/sitemap.xml`] : []), ''].join('\n');
      await writeFile(join(outDir, 'robots.txt'), robots);
    },
  };
}
