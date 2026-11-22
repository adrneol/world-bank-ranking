import './isolation.js';
import test from 'node:test';import assert from 'node:assert/strict';import {buildGrowthComparison,peerAverageGrowth} from '../src/domain/growthComparison.js';
const identities=['IND','USA','JPN','CHN','DEU'];const rates=[10,20,30,-10,0];
for(const key of ['nominal_current','nominal_constant','ppp_current','ppp_constant','total_current','total_constant','total_ppp_current','total_ppp_constant'])test('independent dynamic peer arithmetic '+key,()=>{
 const rowsA=identities.map(iso3=>({iso3,value:100}));const rowsB=identities.map((iso3,i)=>({iso3,value:100+rates[i]}));
 for(const focusIso3 of identities){const result=buildGrowthComparison({rowsA,rowsB,rowsMid:null,focusIso3,yearA:2024,yearB:2025});const iv=result.intervals.AB;const expected=rates.filter((_,i)=>identities[i]!==focusIso3).reduce((a,b)=>a+b,0)/4;
 assert.ok(Math.abs(iv.peerAvgObserved-expected)<1e-10);assert.ok(Math.abs(iv.peerAvgCommon-expected)<1e-10);assert.equal(iv.peerCountObserved,4);assert.equal(iv.peerCountCommon,4);assert.ok(Math.abs(iv.vsPeerObservedPp-(rates[identities.indexOf(focusIso3)]-expected))<1e-10);}
 assert.deepEqual(peerAverageGrowth([{iso3:'JPN',yoyPercent:30}],'JPN'),{mean:null,count:0});assert.deepEqual(peerAverageGrowth([{iso3:'IND',yoyPercent:10}],'JPN'),{mean:10,count:1});
});

test('all eight GDP services and public HTTP follow warm and concurrent focus choices with independent peer membership',async t=>{
 const {createMemoryTestDb}=await import('./helpers/testDb.js');const {METRICS}=await import('../src/config.js');const {createApp}=await import('../src/server.js');const {db,repository}=await createMemoryTestDb();
 await repository.upsertCountries(db,[...identities,'WLD'].map(id=>({id,iso3:id,name:id,isAggregate:id==='WLD',region:'test',regionId:id==='WLD'?'NA':'X'})));
 const keys=['nominal_current','nominal_constant','ppp_current','ppp_constant','total_current','total_constant','total_ppp_current','total_ppp_constant'];
 for(const key of keys){await repository.upsertIndicator(db,{...METRICS[key],name:key,source:'Synthetic WDI'});const indicator=await repository.getIndicatorByMetricKey(db,key);await repository.upsertObservations(db,[...identities,'WLD'].flatMap((id,i)=>[2024,2025].map(year=>({countryId:id,indicatorId:indicator.id,year,value:year===2024?100:100+(rates[i]??900),valueRaw:String(year===2024?100:100+(rates[i]??900)),wbLastUpdated:'2026-01-01'}))));}
 const server=createApp({db,autoRefresh:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 for(const indicator of keys){await Promise.all(identities.map(async(country,i)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/public/comparison/level?'+new URLSearchParams({indicator,country,yearA:2024,yearB:2025,mode:'yoy'}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.focus.iso3,country);assert.equal(body.metric.indicatorCode,METRICS[indicator].indicatorCode);const iv=body.focusMovement.growth.AB;const expected=rates.filter((_,j)=>j!==i).reduce((a,b)=>a+b,0)/4;assert.ok(Math.abs(iv.peerAvgObserved-expected)<1e-9);assert.ok(Math.abs(iv.peerAvgCommon-expected)<1e-9);assert.equal(iv.peerCountObserved,4);assert.equal(iv.peerCountCommon,4);}));}
});
