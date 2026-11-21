/** End-to-end refresh amplification benchmark against synthetic WDI source-2 HTTP. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {observeDatabase} from '../src/db/metrics.js';
process.env.NODE_ENV='test';await import('../test/isolation.js');
process.env.WB_RETRY_BASE_MS='1';process.env.WB_MAX_RETRIES='0';
const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const root=path.resolve(arg('--source',fileURLToPath(new URL('../',import.meta.url))));
const load=name=>import(pathToFileURL(path.join(root,name)));
const {startStubWorldBank,useStubBaseUrl}=await load('test/helpers/stubWorldBank.js');
const {snapshot}=await load('test/fixtures/snapshot.js');
let revision=0,drop=false,extraYear=false;
const stub=await startStubWorldBank({seriesRowsFor:(key,base)=>{
  if(key!=='nominal_current')return base;
  // Thousands of rows, explicitly synthetic, within the existing real registry.
  const template=base.find(r=>r.value!=null);const rows=[];
  for(const country of ['IND','USA','JPN','DEU','BRA','CHN','FRA','GBR','CAN','AUS'])for(let year=1960;year<=2025+Number(extraYear);year++){
    if(drop&&country==='BRA'&&year===2000)continue;
    const changed=country==='IND'&&year<1960+revision;
    const meta=snapshot.countryMetadata.rows.find(row=>row.id===country);
    rows.push({...template,country:{id:meta.iso2Code,value:meta.name},countryiso3code:country,date:String(year),value:(year-1959)*100+country.charCodeAt(0)+(changed?1:0)});
  }
  return rows;
}});useStubBaseUrl(stub.baseUrl);
const {createMemoryDb}=await load('src/db/index.js');
const {refreshData}=await load('src/wb/ingest.js');const client=await createMemoryDb();const observed=observeDatabase(client),db=observed.db;
const results=[];
async function digest(){const r=await client.execute('SELECT country_id,indicator_id,year,value,value_raw,wb_last_updated FROM observations ORDER BY country_id,indicator_id,year');return createHash('sha256').update(JSON.stringify(r.rows)).digest('hex');}
async function run(name,configure=()=>{},range={}){
  configure();observed.reset();const before=await digest(),start=performance.now();
  let result,error;
  try{result=await refreshData({db,startYear:1961,endYear:2025,trigger:'benchmark',...range});}catch(e){error=e.code??e.name;}
  const metrics=observed.snapshot();const after=await digest();
  results.push({name,...metrics,ms:performance.now()-start,status:result?.status??'error',error,errorMessage:result?.errorMessage,rowsUpserted:result?.rowsUpserted,rowsSkippedUnchanged:result?.rowsSkippedUnchanged,before,after});
}
try{
 await run('initial-publication');await run('unchanged');
 await run('one-changed-observation',()=>{revision=1;});
 await run('small-historical-revision',()=>{revision=11;});
 await run('large-historical-revision',()=>{revision=60;});
 await run('dropped-observation',()=>{drop=true;});
 await run('one-new-observation',()=>{drop=false;});
 await run('new-observation-year',()=>{extraYear=true;},{endYear:2026});
 await run('metadata-only-vintage',()=>stub.setSeriesLastUpdated('2026-11-01'),{endYear:2026});
 await run('partial-upstream-failure',()=>stub.failNextMatching({substring:'NY.GDP.PCAP.CD',status:503,times:100}),{endYear:2026});
 stub.reset();stub.setSeriesLastUpdated('2026-11-01');
 const originalTransaction=client.transaction.bind(client);
 client.transaction=async(...args)=>{
   const tx=await originalTransaction(...args),batch=tx.batch.bind(tx);
   tx.batch=async statements=>{
     if(statements.some(s=>/INSERT INTO observations/.test(s.sql??'')))throw Error('Synthetic publication interruption');
     return batch(statements);
   };return tx;
 };
 await run('interrupted-publication',()=>{revision=61;},{endYear:2026});
 client.transaction=originalTransaction;
 await run('retried-refresh',()=>{},{endYear:2026});
 await fs.writeFile(arg('--output','refresh-benchmark.json'),JSON.stringify({synthetic:true,transport:'local libsql disposable WAL file + loopback WDI stub; not billed Turso writes',results},null,2));
 console.log(JSON.stringify(results.map(r=>({name:r.name,status:r.status,observationRowsAffected:r.observationRowsAffected,statements:r.statements}))));
}finally{client.close();await stub.close();}
