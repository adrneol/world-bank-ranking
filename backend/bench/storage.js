/** Disposable file, index and recovery proofs. No configured target is opened. */
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';import {createClient} from '@libsql/client';
import {observeDatabase} from '../src/db/metrics.js';
process.env.NODE_ENV='test';await import('../test/isolation.js');
const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const source=path.resolve(arg('--source',fileURLToPath(new URL('../',import.meta.url))));
const load=name=>import(pathToFileURL(path.join(source,name)));
const {initDatabase,closeDb}=await load('src/db/index.js');const repo=await load('src/db/repository.js');
const {seedConfiguredDatabase}=await load('test/helpers/configuredDb.js');
const {buildIndiaYearlyRows}=await load('src/services/indiaYearly.js');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wdi-bench-storage-'));
if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('wdi-bench-storage-'))throw Error('Unexpected cleanup target');
const client=createClient({url:pathToFileURL(path.join(directory,'startup.db')).href});
const observed=observeDatabase(client);const results=[];
async function measure(name,fn){observed.reset();const start=performance.now();const value=await fn();results.push({name,...observed.snapshot(),ms:performance.now()-start,value});return value;}
let clone;
try{
 await measure('cold-startup',()=>initDatabase(observed.db,{localFile:true}));
 await measure('warm-startup',()=>initDatabase(observed.db,{localFile:true}));
 const pragmas={};for(const key of ['journal_mode','synchronous','busy_timeout','page_size','page_count','freelist_count'])pragmas[key]=(await client.execute('PRAGMA '+key)).rows;
 const fixture=await seedConfiguredDatabase();
 // Mark the synthetic fixture's registry as the required WDI source for the proof.
 await fixture.execute("UPDATE indicators SET source='World Development Indicators'");
 const file=path.join(directory,'fallback.db');await fixture.execute({sql:'VACUUM INTO ?',args:[file]});
 clone=createClient({url:pathToFileURL(file).href});const a=observeDatabase(fixture),b=observeDatabase(clone);
 async function recovery(name,fn){a.reset();b.reset();const start=performance.now();const value=await fn();results.push({name,primary:a.snapshot(),fallback:b.snapshot(),ms:performance.now()-start,value});}
 await recovery('primary-fallback-content-equal',()=>repo.compareDatasetContent(a.db,b.db));
 await recovery('safe-primary-recovery',()=>repo.verifyRecoveryCoverage(a.db,b.db));
 const captured=new Map(),execute=clone.execute.bind(clone),batch=clone.batch.bind(clone);
 const capture=input=>{const statement=typeof input==='string'?{sql:input,args:[]}:input;if(/^\s*SELECT/i.test(statement.sql)&&!captured.has(statement.sql))captured.set(statement.sql,statement);};
 clone.execute=async input=>{capture(input);return execute(input);};
 clone.batch=async(inputs,mode)=>{inputs.forEach(capture);return batch(inputs,mode);};
 await recovery('local-fallback-serving',()=>buildIndiaYearlyRows(b.db,{focusIso3:'IND',startYear:2024,endYear:2024}));
 clone.execute=execute;clone.batch=batch;
 const overviewPlans=[];for(const statement of captured.values())overviewPlans.push({sql:statement.sql,plan:(await clone.execute({sql:'EXPLAIN QUERY PLAN '+statement.sql,args:statement.args??[]})).rows});
 const row=(await clone.execute('SELECT country_id,indicator_id,year FROM observations LIMIT 1')).rows[0];
 await clone.execute({sql:'DELETE FROM observations WHERE country_id=? AND indicator_id=? AND year=?',args:[row.country_id,row.indicator_id,row.year]});
 await recovery('primary-missing-fallback-key',()=>repo.verifyRecoveryCoverage(b.db,a.db));
 let pages;
 try{pages=(await fixture.execute('SELECT name,SUM(pgsize) AS bytes FROM dbstat GROUP BY name')).rows;}catch{pages={available:false,reason:'dbstat unavailable in installed libsql build'};}
 const query={sql:'EXPLAIN QUERY PLAN SELECT year,value,value_raw FROM observations WHERE country_id=? AND indicator_id=? AND year BETWEEN ? AND ? ORDER BY year',args:['IND',1,2004,2024]};
 const before=(await fixture.execute(query)).rows;
 const tx=await fixture.transaction('write');let withoutRedundant;
 try{await tx.execute('DROP INDEX idx_observations_country');withoutRedundant=(await tx.execute(query)).rows;}catch(error){withoutRedundant={available:false,reason:error.code};}finally{await tx.rollback();}
 const restored=(await fixture.execute("PRAGMA index_list('observations')")).rows;
 const disk={};for(const suffix of ['','-wal','-shm'])disk['startup.db'+suffix]=(await fs.stat(path.join(directory,'startup.db')+suffix).catch(()=>({size:0}))).size;
 await fs.writeFile(arg('--output','storage-benchmark.json'),JSON.stringify({synthetic:true,transport:'local disposable WAL files; no hosted Turso',results,pragmas,disk,indexPages:pages,overviewPlans,historyPlans:{before,withoutRedundant,restored},indexExperimentRolledBack:true},null,2));
 console.log('Completed disposable startup, storage, index rollback and recovery workloads.');
}finally{
 clone?.close();closeDb();client.close();
 await fs.rm(directory,{recursive:true,force:true});
}
