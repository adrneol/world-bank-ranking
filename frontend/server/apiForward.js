import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { backendOrigin } from './publication.js';
const catalog=JSON.parse(readFileSync(new URL('../data-catalog.json',import.meta.url),'utf8'));
const routes=new Set(catalog.resources.flatMap(([path])=>[path,path.replace('/api/public/','/api/')]));
for(const path of ['/api/capabilities','/api/health','/api/integrity','/api/geo/country','/api/india/gdp-ranking'])routes.add(path);
export function createApiForward({fetcher=fetch,origin=()=>process.env.BACKEND_API_ORIGIN,secret=()=>process.env.API_PROXY_SECRET,client=req=>process.env.VERCEL==='1'?req.headers['x-vercel-forwarded-for']:req.socket?.remoteAddress,now=Date.now}={}) {
 return async(req,res)=>{
  const fail=(status,code)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(req.method==='HEAD'?undefined:JSON.stringify({error:{code,message:'The research service could not complete this request.'}}));};
  for(const name of ['Cache-Control','CDN-Cache-Control','Vercel-CDN-Cache-Control'])res.setHeader(name,'no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const raw=req.url??'',path=raw.split('?')[0],method=req.method;
  const refresh=path==='/api/data/refresh';
  if(!routes.has(path.toLowerCase().replace(/\/+$/,''))&&!refresh)return fail(404,'NOT_FOUND');
  if(!(refresh?method==='POST':['GET','HEAD'].includes(method))){res.setHeader('Allow',refresh?'POST':'GET, HEAD');return fail(405,'METHOD_NOT_ALLOWED');}
  const upstream=backendOrigin(origin()),key=secret(),ip=client(req);
  if(!upstream||!key||Buffer.byteLength(key)<32||typeof ip!=='string'||!isIP(ip))return fail(503,'PROXY_UNAVAILABLE');
  if(raw.length>16000)return fail(414,'REQUEST_TOO_LONG');
  const time=String(now());
  const headers={Accept:'application/json','x-research-client':ip,'x-research-time':time,'x-research-signature':createHmac('sha256',key).update(`${method}\n${raw}\n${ip}\n${time}`).digest('hex')};
  // Only the existing explicit operator action carries the caller's bearer credential.
  if(refresh&&typeof req.headers.authorization==='string')headers.Authorization=req.headers.authorization;
  let body;
  if(refresh){
   try{
    if(req.body!=null)body=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    else {const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)return fail(413,'BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}body=Buffer.concat(chunks).toString('utf8')||'{}';}
    if(Buffer.byteLength(body)>16384)return fail(413,'BODY_TOO_LARGE');
    const parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return fail(400,'INVALID_BODY');
    headers['Content-Type']='application/json';
   }catch{return fail(400,'INVALID_BODY');}
  }
  try{
   const response=await fetcher(upstream+raw,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(refresh?240000:25000)});
   if(response.status>=300&&response.status<400)return fail(502,'UPSTREAM_REDIRECT');
   const retry=response.headers.get('retry-after');if(retry&&(/^\d{1,6}$/.test(retry)||(/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retry)&&Number.isFinite(Date.parse(retry)))))res.setHeader('Retry-After',retry);
   if(!(response.headers.get('content-type')??'').includes('application/json'))return fail(response.status>=400?response.status:502,'INVALID_UPSTREAM_RESPONSE');
   let text='';if(method!=='HEAD'){const reader=response.body.getReader();let size=0;const chunks=[];for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10*1024*1024){await reader.cancel();return fail(502,'RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(part.value));}text=Buffer.concat(chunks).toString('utf8');}
   // Suppress private configuration accidentally included in an upstream error.
   if(text.includes(upstream)||text.includes(key))return fail(502,'INVALID_UPSTREAM_RESPONSE');
   res.statusCode=response.status;
   res.setHeader('Content-Type','application/json; charset=utf-8');
   res.end(method==='HEAD'?undefined:text);
  }catch{return fail(503,'UPSTREAM_UNAVAILABLE');}
 };
}
