import './isolation.js';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { observeDatabase } from '../src/db/metrics.js';

process.env.WB_RETRY_BASE_MS='1';
let stub,top=2025,staggered=false,revision=false,allNull=false,invalidFuture=false,config,repo,refreshData,createMemoryDb;
mock.timers.enable({apis:['Date'],now:Date.UTC(2026,11,31,23,59,59)});
test.before(async()=>{
  stub=await startStubWorldBank({seriesRowsFor:(key,rows)=>{
    const output=rows.map(row=>revision && key==='nominal_current' && row.countryiso3code==='IND' && row.date==='2024' && row.value!=null ? {...row,value:Number(row.value)+1}:row);
    for(let year=2026;year<=top;year++)for(const iso of ['IND','USA','DEU',...(key==='total_current'?['WLD']:[])]){
      const template=rows.find(row=>row.countryiso3code===iso&&row.value!=null) ?? (iso==='WLD'?rows.find(row=>row.countryiso3code==='IND'&&row.value!=null):null);if(!template)continue;
      output.push({...template,...(iso==='WLD'?{country:{id:'1W',value:'World'},countryiso3code:'WLD'}:{}),date:String(year),value:(allNull&&year===2028)||(staggered&&['inflation_cpi','fdi_inflows'].includes(key))?null:iso==='USA'?0:1000+year/1000});
    }
    if(top>=2027){const template=rows.find(row=>row.countryiso3code==='IND'&&row.value!=null);if(template)output.push({...template,country:{id:'JP',value:'Japan'},countryiso3code:'JPN',date:'2027',value:2000.127});}
    if(invalidFuture&&key==='population_total')output.push({...rows.find(row=>row.countryiso3code==='IND'&&row.value!=null),date:'2028x',value:1});
    return output;
  }});useStubBaseUrl(stub.baseUrl);stub.setSeriesLastUpdated('2030-01-01');
  config=(await import('../src/config.js')).default;
  repo=await import('../src/db/repository.js');
  ({refreshData}=await import('../src/wb/ingest.js'));({createMemoryDb}=await import('../src/db/index.js'));
});
test.after(async()=>{mock.timers.reset();await stub.close();});

async function server(db){const {createApp}=await import('../src/server.js');const http=createApp({db,autoRefresh:false}).listen(0,'127.0.0.1');await new Promise(resolve=>http.once('listening',resolve));return {
  get:async path=>{const r=await fetch('http://127.0.0.1:'+http.address().port+'/api/public/'+path);assert.equal(r.status,200,path);return r.json();},
  close:async()=>{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}};}

test('a running process resolves automatic UTC acquisition at each refresh boundary',async()=>{
  assert.equal(config.ingestEndYear,2026);
  const baseline=await createMemoryDb();try{await refreshData({db:baseline,startYear:2023,endYear:2025,indicators:['population_total'],trigger:'calendar-distinction'});const {buildAvailability}=await import('../src/services/availability.js');assert.equal((await buildAvailability(baseline,{metricKey:'population_total'})).latestYear,2025,'calendar 2026 is not an observation year');}finally{baseline.close();}
  mock.timers.setTime(Date.UTC(2027,0,1));assert.equal(config.ingestEndYear,2027);
  top=2027;const db=await createMemoryDb();
  try{
    const result=await refreshData({db,startYear:2025,indicators:['population_total'],trigger:'rollover-fixture'});
    assert.equal(result.status,'success');assert.equal(result.requestedEndYear,2027);
    assert.ok(stub.state.requests.some(request=>String(request.params.date).endsWith(':2027')));
    mock.timers.setTime(Date.UTC(2027,0,2,1));
    const {maybeAutoRefresh}=await import('../src/wb/ingest.js');const {startMaintenance}=await import('../src/services/maintenance.js');
    let tick;const previous=(await repo.getLatestFetchRun(db,{status:null})).id;
    const stop=startMaintenance(()=>maybeAutoRefresh(db,{ttlHours:24,autoStale:true}),{schedule:fn=>{tick=fn;return {unref(){}};}});
    try{
      await tick();const deadline=performance.now()+60000;let run;
      while(performance.now()<deadline){run=await repo.getLatestFetchRun(db,{status:null});if(run.id>previous&&run.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
      assert.equal(run.status,'success');assert.ok(run.id>previous);assert.equal(run.trigger,'ttl');assert.equal(run.requested_end_year,2027,'owned maintenance uses the fresh UTC year without a visitor refresh');
    }finally{stop();}
    mock.timers.setTime(Date.UTC(2029,0,1));assert.equal(config.ingestEndYear,2029);
  }finally{db.close();top=2025;}
});

test('all twenty indicators traverse staggered release, exact deltas, availability and public retrieval',async t=>{
  mock.timers.setTime(Date.UTC(2031,0,1));const db=await createMemoryDb(),primary=await createMemoryDb();
  const {METRICS}=await import('../src/config.js');const {buildAvailability}=await import('../src/services/availability.js');
  top=2025;staggered=false;revision=false;stub.reset();stub.setSeriesLastUpdated('2030-01-01');
  try{
    const seed=await refreshData({db,startYear:2023,endYear:2025,trigger:'rollover-seed'});assert.equal(seed.status,'success');
    assert.equal((await refreshData({db:primary,startYear:2023,endYear:2025,trigger:'primary-seed'})).status,'success');
    const population=await buildAvailability(db,{metricKey:'population_total',country:'IND'});assert.ok(population.latestYear<=2025);
    const before=await repo.getDatasetState(db);
    top=2026;staggered=true;revision=true;
    const observed=observeDatabase(db);const changed=await refreshData({db:observed.db,startYear:2023,endYear:2026,trigger:'staggered-fixture'});
    assert.equal(changed.status,'success');assert.ok(changed.rowsUpserted<100,'new year does not rewrite full history');
    assert.ok(changed.rowsSkippedUnchanged>0);assert.ok((await repo.getDatasetState(db)).contentVersion>before.contentVersion);
    for(const key of ['inflation_cpi','fdi_inflows'])assert.ok((await buildAvailability(db,{metricKey:key,country:'IND'})).latestYear<2026);
    assert.equal((await buildAvailability(db,{metricKey:'total_current',country:'IND'})).latestYear,2026);
    staggered=false;const complete=await refreshData({db,startYear:2023,endYear:2026,trigger:'full-fixture'});assert.equal(complete.status,'success');
    for(const metric of Object.values(METRICS))await t.test(metric.key,async()=>{
      const api=await server(db);
      try{
        const obs=await api.get(`observations?country=IND&indicator=${metric.key}&year=2026`);
        assert.equal(obs.available,true);assert.equal(obs.observation.value,1002.026);assert.equal(obs.observation.valueRaw,'1002.026');
        assert.equal(obs.metric.indicatorCode,metric.indicatorCode);
        const availability=await api.get(`availability?country=IND&indicator=${metric.key}`);
        assert.equal(availability.latestCountryYear,2026);assert.equal(availability.indicatorCode,metric.indicatorCode);
        const record=await repo.getIndicatorByMetricKey(db,metric.key);
        const expectedCount=Number((await db.execute({sql:'SELECT COUNT(*) AS n FROM observations o JOIN countries c ON c.id=o.country_id WHERE o.indicator_id=? AND o.year=2026 AND c.is_aggregate=0',args:[record.id]})).rows[0].n);
        assert.equal(availability.coverage.find(row=>row.year===2026).observations,expectedCount);
        const ranking=await api.get(`ranking?country=IND&indicator=${metric.key}&year=2026`);
        if(['ASC','DESC'].includes(metric.rankingDirection))assert.equal(ranking.total,expectedCount);else assert.equal(ranking.reason,'RANK_UNSUPPORTED');
        const missing=await api.get(`observations?country=BRA&indicator=${metric.key}&year=2026`);assert.equal(missing.available,false);
        const zero=await api.get(`observations?country=USA&indicator=${metric.key}&year=2026`);assert.equal(zero.observation.value,0);
        t.diagnostic('PHASE51_MATRIX '+JSON.stringify({key:metric.key,code:metric.indicatorCode,unit:metric.unit,year:2026,raw:obs.observation.valueRaw,denominator:expectedCount,zero:true,missing:true,public:true}));
      }finally{await api.close();}
    });
    top=2027;assert.equal((await refreshData({db,startYear:2023,endYear:2027,trigger:'next-year-fixture'})).status,'success');
    const jpn=await buildAvailability(db,{metricKey:'total_current',country:'JPN'});assert.ok(jpn.countryYears.includes(2027));assert.ok(!jpn.entities[0].yoyYears.includes(2027));
    assert.ok((await buildAvailability(db,{metricKey:'total_current',entityA:'country:IND',entityB:'aggregate:WLD'})).commonYears.includes(2027));
    assert.ok((await buildAvailability(db,{metricKey:'total_current',entityA:'group:IND,DEU',entityB:'country:USA'})).commonYears.includes(2027));
    assert.equal((await repo.verifyRecoveryCoverage(primary,db)).safe,false,'returning primary lacks the fallback committed new year');
    const fallbackAPI=await server(db);try{assert.equal((await fallbackAPI.get('observations?country=IND&indicator=total_current&year=2027')).observation.value,1002.027);}finally{await fallbackAPI.close();}
    assert.equal((await refreshData({db:primary,startYear:2023,endYear:2027,trigger:'primary-catchup-fixture'})).status,'success');
    assert.equal((await repo.verifyRecoveryCoverage(primary,db)).safe,true,'equivalent new-year coverage proves recovery');
    const warm=observeDatabase(db);await buildAvailability(warm.db,{metricKey:'total_current',country:'IND'});warm.reset();await buildAvailability(warm.db,{metricKey:'total_current',country:'IND'});assert.equal(warm.snapshot().statements,1,'warm availability reads one generation row');
    const state=await repo.getDatasetState(db);top=2028;allNull=true;
    const emptyYear=await refreshData({db,startYear:2023,endYear:2028,trigger:'all-null-year'});assert.equal(emptyYear.status,'success');assert.equal(emptyYear.rowsUpserted,0);assert.deepEqual(await repo.getDatasetState(db),state);
    allNull=false;invalidFuture=true;const invalid=await refreshData({db,startYear:2023,endYear:2028,trigger:'invalid-future-year'});assert.equal(invalid.status,'partial');assert.deepEqual(await repo.getDatasetState(db),state);invalidFuture=false;
    stub.failNextMatching({substring:'NY.GDP.PCAP.CD',status:503,times:100});
    const failed=await refreshData({db,startYear:2023,endYear:2028,trigger:'failed-rollover'});assert.equal(failed.status,'partial');assert.deepEqual(await repo.getDatasetState(db),state);
  }finally{db.close();primary.close();top=2025;staggered=false;revision=false;allNull=false;invalidFuture=false;}
});

test('explicit administrative limits retain their meaning and invalid modes fail closed',async()=>{
  const {parseYearLimit}=await import('../src/domain/calendar.js');
  assert.equal(parseYearLimit('auto'),null);assert.equal(parseYearLimit(''),null);assert.equal(parseYearLimit('2025'),2025);
  for(const value of ['next','2026junk','999','10000'])assert.throws(()=>parseYearLimit(value));
});
