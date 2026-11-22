import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { closeDb } from '../src/db/index.js';
import { seedConfiguredDatabase } from './helpers/configuredDb.js';
import { bindCatalog } from '../../frontend/server/apiCatalog.js';
process.env.PUBLIC_READ_API_ENABLED='1';

test('all catalog operations have executable typed examples and public reads preserve every fixture table',async t=>{
  const db=await seedConfiguredDatabase();const {createApp}=await import('../src/server.js');
  const server=createApp({db,autoRefresh:true}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));closeDb();});
  const origin='http://127.0.0.1:'+server.address().port;
  const catalog=bindCatalog(JSON.parse(await readFile(new URL('../../frontend/data-catalog.json',import.meta.url),'utf8')),origin);
  async function fingerprint(){const h=createHash('sha256');for(const {name}of(await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows){h.update(name);h.update(JSON.stringify((await db.execute('SELECT * FROM "'+name.replaceAll('"','""')+'"')).rows,(_key,value)=>typeof value==='bigint'?String(value):value));}return h.digest('hex');}
  const before=await fingerprint();assert.equal(catalog.resources.length,31);assert.equal(catalog.operations.length,31);
  for(const operation of catalog.operations){
    assert.equal(operation.method,'GET');assert.ok(catalog.resources.some(([path])=>path===operation.path));
    for(const parameter of operation.parameters)assert.ok(catalog.parameterDefinitions[parameter.name]);
    for(const example of operation.examples){
      const url=new URL(example.url);assert.equal(url.origin,origin);
      for(const parameter of operation.parameters.filter(p=>p.required))assert.ok(url.searchParams.has(parameter.name));
      const response=await fetch(example.url,{headers:{'User-Agent':'ChatGPT-User'}});const body=await response.json();
      assert.equal(response.status,200,operation.path+': '+JSON.stringify(body).slice(0,220));
      assert.match(response.headers.get('content-type'),/application\/json/);assert.equal(response.headers.get('x-auto-refresh'),null);
      assert.match(response.headers.get('cache-control'),/no-store/);
      assert.ok(body.methodology || body.source==='World Bank WDI',operation.path);
    }
  }
  for(const groupMode of ['observed','like_for_like']){
    const response=await fetch(origin+'/api/public/compare?'+new URLSearchParams({indicator:'exports_current',entityA:'group:IND,USA',entityB:'group:DEU,PAK',yearA:2004,yearC:2024,operation:'movement_period_total',groupMode}));
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.mode,groupMode);assert.ok(body.source);
  }
  assert.equal(await fingerprint(),before,'all public examples are read-only');
});
