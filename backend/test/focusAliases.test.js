import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryTestDb } from './helpers/testDb.js';
import { METRICS } from '../src/config.js';
import { sourceAttribution } from '../src/services/attribution.js';

const suffixes=['Value','ValueRaw','ValueDisplay','Rank','RankReason','YoY','YoYDisplay','YoYReason'];
async function fixture(t){
 const {db,repository}=await createMemoryTestDb();
 await repository.upsertCountries(db,[['IND','India'],['BRA','Brazil'],['USA','United States'],['JPN','Japan']].map(([id,name])=>({id,iso3:id,name,isAggregate:false})));
 await repository.upsertIndicator(db,{...METRICS.total_current,name:'Nominal GDP',source:'Synthetic WDI fixture'});
 const indicator=await repository.getIndicatorByMetricKey(db,'total_current');
 await repository.upsertObservations(db,[['BRA',100,125],['IND',120,150],['JPN',160,200],['USA',240,300]].flatMap(([countryId,a,b])=>[2024,2025].map(year=>({countryId,indicatorId:indicator.id,year,value:year===2024?a:b,valueRaw:String(year===2024?a:b),wbLastUpdated:'2026-01-01',fetchedAt:'2026-01-02T00:00:00.000Z'}))));
 const{createApp}=await import('../src/server.js');const server=createApp({db,autoRefresh:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 return async path=>{const response=await fetch('http://127.0.0.1:'+server.address().port+path);return{status:response.status,body:await response.json()};};
}
for(const[country,name,value,rank,previous]of [['BRA','Brazil',125,4,100],['IND','India',150,3,120]])test('annual aliases preserve the complete legacy '+country+' cell',async t=>{
 const get=await fixture(t);const result=await get('/api/public/focus/yearly?country='+country+'&subject=gdp_total&startYear=2023&endYear=2025');assert.equal(result.status,200);assert.deepEqual(result.body.focus,{iso3:country,name,kind:'country'});
 for(const row of result.body.rows)for(const key of result.body.metricKeys){const cell=row[key];for(const suffix of suffixes){assert.ok(Object.hasOwn(cell,'india'+suffix));assert.deepEqual(cell['focus'+suffix],cell['india'+suffix]);}}
 const cell=result.body.rows.find(r=>r.year===2025).total_current;
 assert.equal(cell.indiaValue,value);assert.equal(cell.indiaValueRaw,String(value));assert.equal(cell.indiaRank,rank);assert.equal(cell.indiaRankReason,null);assert.equal(cell.indiaYoY,25);assert.equal(cell.indiaYoYReason,null);assert.equal(cell.previousYearValue,previous);assert.equal(cell.total,4);assert.equal(cell.missingObservations,0);assert.equal(cell.unit,'current US$');assert.equal(cell.available,true);
 const alias=await get('/api/india/gdp-ranking?country='+country+'&subject=gdp_total&startYear=2023&endYear=2025');assert.equal(alias.status,200);assert.deepEqual(alias.body,result.body);
});
test('two-entity comparisons explicitly qualify the retained default-country metadata',async t=>{
 const get=await fixture(t);const response=await get('/api/public/compare?entityA=country%3AUSA&entityB=country%3AJPN&indicator=total_current&yearA=2024&yearC=2025&operation=level');assert.equal(response.status,200);const body=response.body;
 assert.equal(body.entities.a.iso3,'USA');assert.equal(body.entities.b.iso3,'JPN');assert.equal(body.metric.unit,'current US$');assert.equal(body.results.a.values[2025].value,300);assert.equal(body.results.b.values[2025].value,200);
 assert.deepEqual(body.source.focusCountry,{iso3:'IND',name:'India'});assert.equal(body.source.focusCountryRole,'application_default_not_comparison_focus');
 assert.deepEqual(sourceAttribution().focusCountry,{iso3:'IND',name:'India'});assert.equal(Object.hasOwn(sourceAttribution(),'focusCountryRole'),false,'unrelated attribution retains its existing shape');
});
