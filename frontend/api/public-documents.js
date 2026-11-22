import { createHmac, createHash } from 'node:crypto';
import { isIP } from 'node:net';
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
  const ip=process.env.VERCEL==='1'?req.headers?.['x-vercel-forwarded-for']:req.socket?.remoteAddress;
  const key=process.env.API_PROXY_SECRET;
  const canSign=!fetcher && key && Buffer.byteLength(key)>=32 && typeof ip==='string' && isIP(ip);
  const authorityScope=canSign?createHash('sha256').update(ip).digest('hex'):null;
  const signedFetch=canSign?(url,options)=>{const target=new URL(url);const time=String(Date.now());return fetch(url,{...options,headers:{...options.headers,'x-research-client':ip,'x-research-time':time,'x-research-signature':createHmac('sha256',key).update(`GET\n${target.pathname}${target.search}\n${ip}\n${time}`).digest('hex')}});}:fetcher;
  try {
    await respondPublication(req, res, {
      resource,
      backend: process.env.BACKEND_API_ORIGIN?.trim().replace(/\/+$/, ''),
      origin: siteOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null),
      catalog,
      template: loadTemplate,
      fetcher: signedFetch,
      authorityScope,
    });
  } catch {
    publicationFailure(req, res, { resource, rendering: true });
  }
};
}
export default createDocumentHandler();
