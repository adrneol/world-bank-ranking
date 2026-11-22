import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App.jsx';
import OverviewHistory from './sections/OverviewHistory.jsx';
import { ResearchPreferences } from './hooks/researchPreferences.jsx';
import { flushReact, stubFetch } from './test-utils.js';
import indicators from './fixtures/indicatorRegistry.json';

let cleanup,stub;
const reply=body=>({ok:true,status:200,headers:new Headers(),json:async()=>body});
const countries={countries:[{iso3:'IND',name:'India'},{iso3:'USA',name:'United States'},{iso3:'JPN',name:'Japan'}]};

function setup({countryLatest=2026,yoyLatest=2025,deferred=false,max=2026,lagCpi=true,scopedMax,scopedGeneration,globalGeneration=1,globalProvider='sqlite',scopedProvider,legacyFingerprint=false}={}){
  const state={max,generation:globalGeneration,provider:globalProvider};let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const years=()=>Array.from({length:state.max-2023+1},(_,i)=>2023+i);
  const perMetric=()=>Object.fromEntries(indicators.production.map(metric=>[metric.key,metric.key==='inflation_cpi'&&lagCpi?[2023,2024,2025]:years()]));
  stub=stubFetch([
    ['/api/years',()=>reply({years:years(),minYear:2023,maxYear:state.max,defaults:{startYear:2023,endYear:2025},generation:{contentVersion:state.generation},database:{provider:state.provider},perMetric:perMetric()})],
    ['/api/countries',countries],['/api/indicators',indicators],['/api/capabilities',{publicReadApiEnabled:false}],
    ['/api/availability',url=>{
      const p=new URL(url,'http://fixture').searchParams,metric=p.get('indicator');
      const y=metric==='inflation_cpi'&&lagCpi?[2023,2024,2025]:Array.from({length:(scopedMax??state.max)-2023+1},(_,i)=>2023+i);
      const country=p.get('country');const cy=country==='JPN'?y.filter(year=>year<=countryLatest):y;
      const common=p.get('entityB')==='country:JPN'?[2023,2024]:cy;
      const yoySupported=indicators.production.find(item=>item.key===metric)?.validChangeTypes.includes('YOY')??false;
      const value={metricKey:metric,years:y,countryYears:cy,commonYears:common,yoyYears:yoySupported?y.filter(year=>year<=yoyLatest):[],yoySupported,latestYoyYear:yoySupported?yoyLatest:null,generation:{contentVersion:scopedGeneration??state.generation},database:{provider:scopedProvider??state.provider}};
      return deferred?wait.then(()=>reply(value)):reply(value);
    }],
    ['/api/data-status',()=>reply({empty:false,inProgress:false,observations:100+state.generation,fresh:true,lastSuccessAt:`2026-01-0${state.generation}T00:00:00Z`,years:{maxYear:state.max,perMetric:perMetric()},generation:{contentVersion:state.generation},database:{provider:state.provider},wbLastUpdated:'2030-01-01',lastRun:{status:'partial',started_at:'2026-01-03T00:00:00Z'},fingerprint:{runId:legacyFingerprint?null:state.generation,observationCount:100+state.generation},capabilities:{publicReadApiEnabled:false}})],
    ['/api/focus/yearly',url=>{const p=new URL(url,'http://fixture').searchParams;const country=p.get('country');return reply({focus:{iso3:country,name:countries.countries.find(c=>c.iso3===country)?.name},eligibleUniverse:3,rows:[{year:Number(p.get('startYear'))}]});}],
    ['/api/focus/history',url=>{const p=new URL(url,'http://fixture').searchParams;return reply({series:p.get('series').split(',').map(id=>({id,points:Array.from({length:Number(p.get('endYear'))-Number(p.get('startYear'))+1},(_,i)=>({year:Number(p.get('startYear'))+i,value:i+1,raw:String(i+1)}))}))});}],
    ['/api/yoy-ranking?',{available:true,metric:{key:'total_current'},rows:[],total:0,eligibleUniverse:3,page:1,pageSize:50,pages:1,search:{query:null,matches:[],matchCount:0},notes:[],source:{}}],
    ['/api/compare?',{available:false,reason:'MISSING_REQUIRED_DATA',results:null,analysis:null,universe:null,diagnostics:[],metric:{key:'total_current'},entities:{a:{kind:'country',iso3:'USA',name:'United States'},b:{kind:'country',iso3:'JPN',name:'Japan'}}}],
    ['/api/',{}],
  ]);
  return {state,release};
}
function mount(url){window.history.replaceState(null,'',url);const container=document.createElement('div');document.body.append(container);const root=createRoot(container);act(()=>root.render(<App/>));cleanup=()=>{act(()=>root.unmount());container.remove();};return container;}
async function choose(container,id,label){act(()=>container.querySelector('#'+id).click());await flushReact(act);const option=[...document.querySelectorAll('.combo-option')].find(el=>el.textContent===label);expect(option).toBeTruthy();act(()=>option.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));await flushReact(act);}
afterEach(()=>{cleanup?.();cleanup=null;stub?.restore();stub=null;vi.useRealTimers();window.history.replaceState(null,'','/');document.body.innerHTML='';});

it('Overview follows the latest published economy year while preserving a shared automatic URL',async()=>{
  setup({countryLatest:2024});const container=mount('/overview/?country=JPN&metric=total_current');await flushReact(act,12);
  expect(container.querySelector('.app-header h1').textContent).toBe('Japan — 2024');
  expect(new URLSearchParams(location.search).get('year')).toBe('latest');
  expect(stub.calls.some(url=>url.includes('/focus/yearly')&&url.includes('startYear=2024'))).toBe(true);
});
it('an explicit unavailable historical year stays visible and offers a recovery action',async()=>{
  setup({countryLatest:2024});const container=mount('/overview/?country=JPN&metric=total_current&year=2025');await flushReact(act,12);
  expect(container.querySelector('.app-header h1').textContent).toBe('Japan — 2025');
  expect(container.textContent).toContain('No published observations for the requested year 2025');
  const recover=[...container.querySelectorAll('button')].find(el=>el.textContent==='Use latest available');act(()=>recover.click());await flushReact(act);
  expect(container.querySelector('.app-header h1').textContent).toBe('Japan — 2024');
});
it('indicator-specific defaults and YoY defaults use published years and valid pairs',async()=>{
  setup();let container=mount('/overview/?country=IND&metric=inflation_cpi');await flushReact(act,12);expect(container.querySelector('.app-header h1').textContent).toBe('India — 2025');cleanup();cleanup=null;
  container=mount('/yoy/?country=IND&metric=total_current');await flushReact(act,12);
  expect(container.querySelector('.app-header h1').textContent).toBe('India — 2025');
  expect(stub.calls.some(url=>url.includes('/api/yoy-ranking?')&&url.includes('year=2025'))).toBe(true);
});
it('a late availability response cannot overwrite a deliberately selected historical year',async()=>{
  const {release}=setup({deferred:true});const container=mount('/overview/?country=IND&metric=total_current');await flushReact(act,12);
  await choose(container,'f-year','2024');release();await flushReact(act,12);
  expect(new URLSearchParams(location.search).get('year')).toBe('2024');expect(container.querySelector('.app-header h1').textContent).toBe('India — 2024');
  act(()=>container.querySelector('#f-year').click());await flushReact(act);expect(document.body.textContent).toContain('Latest available · 2026');
  expect(stub.calls.filter(url=>url.includes('/focus/yearly')).every(url=>url.includes('startYear=2024'))).toBe(true);
});
it('Compare initializes automatic periods from common same-year entity inputs',async()=>{
  setup();mount('/compare/?country=IND&cmpEntityA=country:USA&cmpEntityB=country:JPN&cmpMetric=total_current');await flushReact(act,12);
  const call=stub.calls.find(url=>url.includes('/api/compare?'));expect(call).toBeTruthy();
  const params=new URL(call,'http://fixture').searchParams;expect(params.get('yearA')).toBe('2023');expect(params.get('yearB')).toBe('2024');
});
it.each(['latest','2024'])('publication advances only automatic year selection (%s)',async selected=>{
  vi.useFakeTimers({shouldAdvanceTime:true});const {state}=setup({max:2025});
  const container=mount('/overview/?country=IND&metric=total_current&year='+selected);await flushReact(act,12);
  await act(async()=>{await vi.advanceTimersByTimeAsync(31000);});await flushReact(act,12);
  state.max=2026;state.generation=2;
  await act(async()=>{await vi.advanceTimersByTimeAsync(61000);});await flushReact(act,16);
  expect(container.querySelector('.app-header h1').textContent).toBe('India — '+(selected==='latest'?2026:2024));
  expect(new URLSearchParams(location.search).get('year')).toBe(selected);
});
it('chart modes, custom windows and following presets survive a data remount',async()=>{
  setup();const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let show=true,years=[2023,2024,2025];
  const render=()=>act(()=>root.render(<ResearchPreferences scope="test-history">{show?<OverviewHistory country="IND" displayName="India" historyKey="total_current" availableYears={years} metricYears={{total_current:years}}/>:null}</ResearchPreferences>));
  cleanup=()=>{act(()=>root.unmount());container.remove();};render();await flushReact(act,12);
  act(()=>[...container.querySelectorAll('button')].find(el=>el.textContent==='Bar chart').click());
  act(()=>[...container.querySelectorAll('button')].find(el=>el.textContent==='Fixed').click());
  const period=container.querySelector('[id$="-period"]');act(()=>period.click());await flushReact(act);
  act(()=>[...document.querySelectorAll('.combo-option')].find(el=>el.textContent.replaceAll('✓','').trim()==='Recent 10 years').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));await flushReact(act);
  show=false;render();years=[2023,2024,2025,2026];show=true;render();await flushReact(act,12);
  expect([...container.querySelectorAll('button')].find(el=>el.textContent==='Bar chart').getAttribute('aria-pressed')).toBe('true');
  expect([...container.querySelectorAll('button')].find(el=>el.textContent==='Fixed').getAttribute('aria-pressed')).toBe('true');
  expect(stub.calls.filter(url=>url.includes('/focus/history')).at(-1)).toContain('endYear=2026');
  act(()=>container.querySelector('[id$="-period"]').click());await flushReact(act);
  act(()=>[...document.querySelectorAll('.combo-option')].find(el=>el.textContent==='Custom range').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));await flushReact(act);
  show=false;render();years=[2023,2024,2025,2026,2027];show=true;render();await flushReact(act,12);
  expect(stub.calls.filter(url=>url.includes('/focus/history')).at(-1)).toContain('endYear=2026');
  show=false;render();years=[2023,2024,2025];show=true;render();await flushReact(act,12);
  expect(stub.calls.filter(url=>url.includes('/focus/history')).at(-1)).toContain('endYear=2026');
});

it.each(indicators.production)('newly published years remain selectable for $key',async metric=>{
  setup({lagCpi:false});const container=mount('/overview/?country=IND&metric='+metric.key);await flushReact(act,12);
  expect(container.querySelector('.app-header h1').textContent).toBe('India — 2026');
  expect(container.querySelector('#f-year').textContent).toContain('2026');
  expect(stub.calls.some(url=>url.includes('/focus/yearly')&&url.includes('startYear=2026'))).toBe(true);
});
it('Status distinguishes published economy year from vintage and the last attempt',async()=>{
  setup();const container=mount('/status/');await flushReact(act,12);
  const value=label=>[...container.querySelectorAll('dt')].find(el=>el.textContent===label)?.nextElementSibling?.textContent;
  expect(value('Latest published economy year')).toBe('2026');
  expect(value('World Bank data vintage')).toContain('2030');
  expect(value('Last refresh attempt (UTC)')).toContain('partial');
  expect(value('Published content generation')).toBe('v1');
});

it.each([{globalGeneration:1,scopedGeneration:2,scopedMax:2026,globalProvider:'turso',scopedProvider:'turso',expected:2026},{globalGeneration:2,scopedGeneration:1,scopedMax:2024,globalProvider:'turso',scopedProvider:'sqlite-fallback',expected:2024}])('scoped snapshots stay usable when global metadata or serving counters differ ($expected)',async options=>{
  setup({...options,max:2025});const container=mount('/overview/?country=IND&metric=total_current');await flushReact(act,12);
  expect(container.querySelector('.app-header h1').textContent).toBe('India — '+options.expected);
  expect(container.textContent).not.toContain('Checking published year availability');
  expect(stub.calls.filter(url=>url.includes('/api/availability'))).toHaveLength(1);
});
it('the first status poll detects a publication that happened after bootstrap',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});const {state}=setup({max:2025});const container=mount('/overview/?country=IND&metric=total_current');await flushReact(act,12);
  state.max=2026;state.generation=2;await act(async()=>{await vi.advanceTimersByTimeAsync(31000);});await flushReact(act,16);
  expect(container.querySelector('.app-header h1').textContent).toBe('India — 2026');
});
it('the first status poll never treats equal versions on different serving targets as identity',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});const {state}=setup({max:2026,globalProvider:'turso'});const container=mount('/overview/?country=IND&metric=total_current');await flushReact(act,12);
  state.max=2024;state.provider='sqlite-fallback';await act(async()=>{await vi.advanceTimersByTimeAsync(31000);});await flushReact(act,16);
  expect(container.querySelector('.app-header h1').textContent).toBe('India — 2024');
});

it('content versions detect a later publication even when a legacy fingerprint has no successful run',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});const {state}=setup({max:2025,legacyFingerprint:true});const container=mount('/overview/?country=IND&metric=total_current');await flushReact(act,12);
  await act(async()=>{await vi.advanceTimersByTimeAsync(31000);});await flushReact(act);
  state.max=2026;state.generation=2;await act(async()=>{await vi.advanceTimersByTimeAsync(61000);});await flushReact(act,16);
  expect(container.querySelector('.app-header h1').textContent).toBe('India — 2026');
});
