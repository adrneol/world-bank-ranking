import assert from 'node:assert/strict';
import test from 'node:test';
import { observationDelta } from '../src/wb/observationDelta.js';
import { observeDatabase } from '../src/db/metrics.js';
import { singleFlight, MAX_ACTIVE_READ_KEYS } from '../src/services/singleFlight.js';
import { getCachedExpensiveIntegrity } from '../src/services/statusCache.js';
import { startMaintenance } from '../src/services/maintenance.js';
import { compareInvalidationSignals, compareCacheKey, getCachedCompare, setCachedCompare } from '../src/services/compareCache.js';
import { seedEdgeCaseDb } from './helpers/testDb.js';

test('delta preserves zero, raw precision, vintage, deletions and inserts exactly', () => {
  const row = {countryId:'IND',year:2024,value:0,valueRaw:'0',wbLastUpdated:'2026-01-01'};
  assert.deepEqual(observationDelta([row],[{...row}]),{upserts:[],removals:[],unchanged:1});
  for (const change of [{value:1,valueRaw:'1'},{valueRaw:'0.0'},{wbLastUpdated:'2026-02-01'},{year:2025}]) {
    const next={...row,...change};const delta=observationDelta([row],[next]);
    assert.deepEqual(delta.upserts,[next]);assert.equal(delta.unchanged,0);
    assert.equal(delta.removals.length,change.year?1:0);
  }
  assert.deepEqual(observationDelta([row],[]).removals,[row]);
  assert.deepEqual(observationDelta([],[row]).upserts,[row]);
});

test('Compare derived generations avoid signature scans; outside writes restore the exact legacy proof', async () => {
  const {db,repository}=await seedEdgeCaseDb();const observed=observeDatabase(db);
  try {
    const indicator=await repository.getIndicatorByMetricKey(db,'nominal_current');
    await repository.upsertDatasetStateInner(db,{...await repository.computeDatasetState(db),contentVersion:1});
    const first=await compareInvalidationSignals(observed.db,indicator.id,[2024]);
    assert.equal(observed.snapshot().statements,1);assert.equal(first.signature,null);
    await repository.upsertObservation(db,{countryId:'IND',indicatorId:indicator.id,year:2024,value:0,valueRaw:'0',wbLastUpdated:'2026-02-01'});
    observed.reset();const legacy=await compareInvalidationSignals(observed.db,indicator.id,[2024]);
    assert.equal(observed.snapshot().statements,2);assert.ok(legacy.signature.rows>0);
    setCachedCompare(db,compareCacheKey(legacy),{stale:true});
    assert.equal(getCachedCompare(db,compareCacheKey(legacy)),undefined,'count/vintage alone must not cache legacy values');
    await repository.upsertDatasetStateInner(db,{...await repository.computeDatasetState(db),contentVersion:2});
    const next=await compareInvalidationSignals(observed.db,indicator.id,[2024]);
    assert.notEqual(compareCacheKey(first),compareCacheKey(next));
  } finally {db.close();}
});

test('bounded Overview uses five SELECTs in one batch and concurrent reads share work', async () => {
  const {db,repository}=await seedEdgeCaseDb();const observed=observeDatabase(db);
  const {buildIndiaYearlyRows}=await import('../src/services/indiaYearly.js');
  try {
    const options={focusIso3:'IND',startYear:2024,endYear:2024};
    const results=await Promise.all(Array.from({length:8},()=>buildIndiaYearlyRows(observed.db,options)));
    assert.equal(observed.snapshot().clientCalls,1);assert.equal(observed.snapshot().statements,5);
    results.forEach(result=>assert.deepEqual(result,results[0]));
    // No settled response cache: an outside writer's correction is immediately visible.
    const indicator=await repository.getIndicatorByMetricKey(db,'nominal_current');
    await repository.upsertObservation(db,{countryId:'IND',indicatorId:indicator.id,year:2024,value:0,valueRaw:'0'});
    observed.reset();const updated=await buildIndiaYearlyRows(observed.db,options);
    assert.equal(updated.rows[0].nominal_current.indiaValue,0);assert.equal(observed.snapshot().clientCalls,1);
    const other=await buildIndiaYearlyRows(observed.db,{...options,focusIso3:'USA'});
    assert.equal(other.focus.iso3,'USA');
  } finally { db.close(); }
});

test('integrity cold misses share one proof; rejection cleans up and newer keys win', async () => {
  const scope={};let count=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const jobs=Array.from({length:8},()=>getCachedExpensiveIntegrity('v1',async()=>{count++;await gate;return {passed:true};},scope));
  await Promise.resolve();assert.equal(count,1);release();await Promise.all(jobs);
  let releaseOld;const old=new Promise(resolve=>{releaseOld=resolve;});
  const first=getCachedExpensiveIntegrity('old',()=>old,scope);
  await getCachedExpensiveIntegrity('new',async()=>({passed:true,newer:true}),scope);
  releaseOld({passed:false});await first;
  assert.equal((await getCachedExpensiveIntegrity('new',()=>assert.fail('new proof lost'),scope)).report.newer,true);
  await assert.rejects(getCachedExpensiveIntegrity('bad',async()=>{throw Error('transient');},scope));
  assert.equal((await getCachedExpensiveIntegrity('bad',async()=>({passed:true}),scope)).report.passed,true);
});

test('single flight is per handle, bounded and never retains rejected work', async () => {
  const scope={},other={};let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const compute=()=>{calls++;return gate;};
  const tasks=Array.from({length:MAX_ACTIVE_READ_KEYS+1},(_,i)=>singleFlight(scope,String(i),compute));
  await singleFlight(other,'0',async()=>true);await Promise.resolve();
  assert.equal(calls,MAX_ACTIVE_READ_KEYS+1);release(true);await Promise.all(tasks);
  await assert.rejects(singleFlight(scope,'failure',async()=>{throw Error('failed');}));
  assert.equal(await singleFlight(scope,'failure',async()=>42),42);
});

test('server-owned maintenance skips overlapping ticks and stops cleanly', async () => {
  let tick,release,calls=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const stop=startMaintenance(async()=>{calls++;await gate;},{schedule:fn=>{tick=fn;return {unref(){}};}});
  const running=tick();await tick();assert.equal(calls,1);release();await running;
  await tick();assert.equal(calls,2);stop();await tick();assert.equal(calls,2);
});

test('status GET variants cannot persist verification through readOnly manipulation', async t => {
  const {db,repository}=await seedEdgeCaseDb();
  await repository.upsertDatasetStateInner(db,{...await repository.computeDatasetState(db),contentVersion:1});
  const {createApp}=await import('../src/server.js');
  const server=createApp({db,autoRefresh:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
  const before=await repository.getDatasetState(db);
  for(const suffix of ['','?readOnly=0','?readOnly=no','?readOnly=1']){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/data-status${suffix}`);assert.equal(response.status,200);await response.json();
  }
  assert.deepEqual(await repository.getDatasetState(db),before);
});
