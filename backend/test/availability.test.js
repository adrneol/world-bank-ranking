import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryDb } from '../src/db/index.js';
import * as repo from '../src/db/repository.js';
import { METRICS } from '../src/config.js';
import { buildAvailability } from '../src/services/availability.js';
import { observeDatabase } from '../src/db/metrics.js';

async function seed(){const db=await createMemoryDb();await repo.upsertCountries(db,[{id:'IND',iso3:'IND',iso2:'IN',name:'India',isAggregate:false},{id:'USA',iso3:'USA',iso2:'US',name:'United States',isAggregate:false}]);await repo.upsertIndicator(db,{...METRICS.total_current,source:'World Development Indicators'});const indicator=await repo.getIndicatorByMetricKey(db,'total_current');await repo.upsertObservations(db,[{countryId:'IND',indicatorId:indicator.id,year:2024,value:10,valueRaw:'10',wbLastUpdated:'2026-01-01'},{countryId:'IND',indicatorId:indicator.id,year:2025,value:20,valueRaw:'20',wbLastUpdated:'2026-01-01'},{countryId:'USA',indicatorId:indicator.id,year:2024,value:0,valueRaw:'0',wbLastUpdated:'2026-01-01'}]);await repo.upsertDatasetStateInner(db,{...await repo.computeDatasetState(db),contentVersion:1});return {db,indicator};}
test('availability uses valid same-economy positive predecessors and keeps zero distinct from missing',async()=>{
  const {db,indicator}=await seed();try{
    const value=await buildAvailability(db,{metricKey:'total_current',country:'IND'});assert.deepEqual(value.yoyYears,[2025]);assert.equal(value.latestCountryYear,2025);
    const missing=await buildAvailability(db,{metricKey:'total_current',country:'USA'});assert.deepEqual(missing.countryYears,[2024]);assert.deepEqual(missing.entities[0].yoyYears,[]);
    await repo.upsertObservation(db,{countryId:'IND',indicatorId:indicator.id,year:2026,value:0,valueRaw:'0',wbLastUpdated:'2026-01-01'});
    assert.equal((await buildAvailability(db,{metricKey:'total_current',country:'IND'})).latestCountryYear,2026,'outside writes invalidate cached generation');
    await repo.upsertDatasetStateInner(db,{...await repo.computeDatasetState(db),contentVersion:2});
    assert.ok((await buildAvailability(db,{metricKey:'total_current',country:'IND'})).entities[0].yoyYears.includes(2026));
  }finally{db.close();}
});
test('availability shares cold request work and warm reads use one generation row',async()=>{
  const {db}=await seed();const observed=observeDatabase(db);try{
    const results=await Promise.all(Array.from({length:3},()=>buildAvailability(observed.db,{metricKey:'total_current',country:'IND'})));
    assert.ok(observed.snapshot().statements<=8);assert.deepEqual(results[0],results[2]);
    observed.reset();await buildAvailability(observed.db,{metricKey:'total_current',country:'IND'});assert.equal(observed.snapshot().statements,1);
    observed.reset();await buildAvailability(observed.db,{metricKey:'total_current',entityA:'country:IND',basis:'level'});assert.equal(observed.snapshot().statements,1,'equivalent raw country scopes share metadata');
    observed.reset();await buildAvailability(observed.db,{metricKey:'total_current',country:'USA'});assert.ok(observed.snapshot().statements<=5,'global pair coverage is shared across economies');
    await assert.rejects(buildAvailability(db,{metricKey:'total_current',country:'WLD'}));
    await assert.rejects(buildAvailability(db,{metricKey:'total_current',entityA:'group:'}));
  }finally{db.close();}
});
test('weighted group availability admits zero members and preserves raw country-ratio availability',async()=>{
  const {db,indicator}=await seed();try{
    for(const key of ['fdi_inflows','fdi_inflows_pct_gdp'])await repo.upsertIndicator(db,{...METRICS[key],source:'World Development Indicators'});
    const numerator=await repo.getIndicatorByMetricKey(db,'fdi_inflows'),ratio=await repo.getIndicatorByMetricKey(db,'fdi_inflows_pct_gdp');
    await repo.upsertObservations(db,[{countryId:'USA',indicatorId:indicator.id,year:2025,value:0},{countryId:'IND',indicatorId:numerator.id,year:2025,value:2},{countryId:'USA',indicatorId:numerator.id,year:2025,value:0},{countryId:'USA',indicatorId:ratio.id,year:2025,value:0},{countryId:'USA',indicatorId:ratio.id,year:2026,value:0}]);
    await repo.upsertDatasetStateInner(db,{...await repo.computeDatasetState(db),contentVersion:2});
    const result=await buildAvailability(db,{metricKey:'fdi_inflows_pct_gdp',entityA:'group:IND,USA',entityB:'country:USA'});
    assert.equal(result.entities[0].latestYear,2025);assert.equal(result.entities[1].latestYear,2026);assert.ok(result.commonYears.includes(2025));
  }finally{db.close();}
});
test('availability keeps a complete snapshot while a newer generation publishes',async()=>{
  const {db,indicator}=await seed();const original=db.transaction.bind(db);let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),paused=new Promise(resolve=>{started=resolve;});let first=true;
  db.transaction=async mode=>{const tx=await original(mode);if(mode==='read'&&first){first=false;const execute=tx.execute.bind(tx);tx.execute=async statement=>{if((statement.sql??'').includes('AS validPairs')){started();await gate;}return execute(statement);};}return tx;};
  const old=buildAvailability(db,{metricKey:'total_current',country:'IND'});old.catch(()=>{});
  try{
    await paused;
    const captured=await repo.getDatasetState(db);
    await repo.upsertObservation(db,{countryId:'IND',indicatorId:indicator.id,year:2026,value:30,valueRaw:'30',wbLastUpdated:'2026-01-01'});
    await repo.upsertDatasetStateInner(db,{...await repo.computeDatasetState(db),contentVersion:2});
    const current=await buildAvailability(db,{metricKey:'total_current',country:'IND'});assert.equal(current.generation.contentVersion,2);assert.equal(current.latestCountryYear,2026);
    const {getCachedAvailableYears}=await import('../src/services/yearsCache.js');
    assert.ok(!(await getCachedAvailableYears(db,captured)).years.includes(2026),'a captured year payload stays with its own generation');
    assert.ok((await getCachedAvailableYears(db)).years.includes(2026));
    release();const previous=await old;assert.equal(previous.generation.contentVersion,1);assert.equal(previous.latestCountryYear,2025);assert.ok(!previous.years.includes(2026));
  }finally{release();await old.catch(()=>{});db.transaction=original;db.close();}
});
