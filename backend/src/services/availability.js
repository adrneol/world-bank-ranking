import { METRICS } from '../config.js';
import { compareBasisIdsForMetric } from './entityCompare.js';
import { calendarYear } from '../domain/calendar.js';
import { COMPARE_BASIS_LEGS } from '../domain/compareBasis.js';
import { groupRatioFromSums } from '../domain/transforms.js';
import { compareBasisMetricForAnalysis } from './compareMovementBasis.js';
import { getAnnualPairCoverage, getDatasetState, getIndicatorByMetricKey, getEntityAvailabilityRows } from '../db/repository.js';
import { parseEntitySpec, resolveEntity } from './entities.js';
import { singleFlight } from './singleFlight.js';

const scopes = new WeakMap();
const MAX_KEYS = 64;
const last = years => years.at(-1) ?? null;
function cacheFor(db, version) {
  let cache = scopes.get(db);
  if (!cache || cache.version !== version) { cache = {version, requests:new Map(), global:new Map()}; scopes.set(db, cache); }
  return cache;
}

/** Bounded, generation-aware availability; raw input presence is not a calculation. */
export async function buildAvailability(db, {metricKey, country, entityA, entityB, basis} = {}) {
  const metric = METRICS[metricKey];
  if (!metric) throw Object.assign(new Error('Choose a registered indicator.'), {code:'INVALID_INDICATOR',httpStatus:400});
  if (basis && basis!=='level' && !compareBasisIdsForMetric(metricKey).includes(basis)) throw Object.assign(new Error('Choose a registered measurement basis.'),{code:'INVALID_BASIS',httpStatus:400});
  const selectedBasis=!basis||basis==='level'?metricKey:basis;
  const specs=[entityA || (country ? `country:${country}` : null),entityB].filter(Boolean).map(spec=>parseEntitySpec(spec));
  const initial = await getDatasetState(db);
  const content = Number.isInteger(initial?.contentVersion) && initial.contentVersion>0 ? initial.contentVersion : null;
  const version = `${content}:${calendarYear()}`;
  const cache = cacheFor(db, version);
  const key = JSON.stringify([metricKey,specs.map(spec=>[spec.kind,spec.iso3??spec.members]),selectedBasis]);
  if (content != null && cache.requests.has(key)) return cache.requests.get(key);
  return singleFlight(db, 'availability:'+version+':'+key, async () => {
    const tx = await db.transaction('read');
    let result;
    try {
      const state = await getDatasetState(tx);
      const indicator = await getIndicatorByMetricKey(tx,metricKey);
      const rawYoy=metric.validChangeTypes.includes('YOY');
      const max = Math.min(9999,calendarYear()+1);
      const yearsDomain = Array.from({length:max-1960+1},(_,i)=>1960+i);
      // Resolve every supplied identity strictly, including custom group eligibility.
      const entities = [];
      for (const spec of specs) entities.push(await resolveEntity(tx,spec));
      let coverage = [];
      if (indicator) {
        if (content != null && state?.contentVersion === content && cache.global.has(metricKey)) coverage = cache.global.get(metricKey);
        else {
          coverage = content!=null && state?.contentVersion===content
            ? await singleFlight(db,'availabilityCoverage:'+version+':'+metricKey,()=>getAnnualPairCoverage(tx,indicator.id,max,rawYoy))
            : await getAnnualPairCoverage(tx,indicator.id,max,rawYoy);
          if (content != null && state?.contentVersion === content && scopes.get(db)===cache) cache.global.set(metricKey,coverage);
        }
      }
      const basisMetric=compareBasisMetricForAnalysis(metric,selectedBasis,'level')??metric;
      const supportsYoy = basisMetric.validChangeTypes.includes('YOY');
      const years = coverage.map(row=>row.year);
      const yoyYears = supportsYoy ? coverage.filter(row=>row.validPairs>0).map(row=>row.year) : [];
      const group = entities.some(entity=>entity.members);
      const basisLegs = COMPARE_BASIS_LEGS[selectedBasis];
      const ratioLegs = group && metric.aggregation==='WEIGHTED_RATIO'
        ? [metric.requiredDenominator.numeratorMetric,metric.requiredDenominator.metricKey] : null;
      const requiredLegs=entity=>basisLegs??(entity.members&&ratioLegs?ratioLegs:[metricKey]);
      const supportedEntity=entity=>Boolean(indicator) && (!entity.members || basisLegs || ['SUM','WEIGHTED_RATIO'].includes(metric.aggregation));
      const supportedEntities=entities.filter(supportedEntity);
      const legs = [...new Set(supportedEntities.flatMap(requiredLegs))];
      const observations = new Map();
      for (const leg of legs) {
        const record = leg===metricKey ? indicator : await getIndicatorByMetricKey(tx,leg);
        const ids=[...new Set(supportedEntities.filter(entity=>requiredLegs(entity).includes(leg)).flatMap(entity=>entity.members??[entity.iso3]))];
        const rows = record ? await getEntityAvailabilityRows(tx,record.id,ids,max) : [];
        observations.set(leg,new Map(rows.map(row=>[`${row.iso3}:${row.year}`,row])));
      }
      const entityAvailability = entities.map(entity=>{
        const members=entity.members ?? [entity.iso3];
        const required=requiredLegs(entity);
        const supported = supportedEntity(entity);
        const available = supported ? yearsDomain.filter(year=>{
          if(!required.every(leg=>members.every(id=>Number.isFinite(observations.get(leg).get(`${id}:${year}`)?.value))))return false;
          const ratio=basisLegs??(entity.members?ratioLegs:null);
          if(!ratio)return true;
          // The existing domain primitive admits zero-valued members while
          // requiring a positive aggregate denominator; never require each
          // member denominator to be positive or reconstruct a raw country ratio.
          return groupRatioFromSums({numerators:members.map(id=>observations.get(ratio[0]).get(`${id}:${year}`).value),denominators:members.map(id=>observations.get(ratio[1]).get(`${id}:${year}`).value)}).computable;
        }) : [];
        const pairs=supportsYoy && !entity.members && required.length===1 && required[0]===metricKey ? available.filter(year=>
          observations.get(metricKey).get(`${entity.iso3}:${year-1}`)?.value>0) : [];
        return { kind:entity.kind, iso3:entity.iso3 ?? null, members:entity.members ?? null,
          years:available, latestYear:last(available),yoyYears:pairs,latestYoyYear:last(pairs),reason:!indicator?'METRIC_NOT_INGESTED':supported ? null : 'NOT_AGGREGATABLE' };
      });
      const common = entityAvailability.length ? entityAvailability[0].years.filter(year=>entityAvailability.every(entity=>entity.years.includes(year))) : years;
      result = {metricKey,indicatorCode:metric.indicatorCode,unit:basisMetric.unitLong ?? basisMetric.unit,basis:selectedBasis,
        yearDomain:{min:1960,max,historyMaxYears:100},
        requiredIndicators:legs.map(key=>({metricKey:key,indicatorCode:METRICS[key].indicatorCode,unit:METRICS[key].unit})),
        years,latestYear:last(years),minYear:years[0]??null,yoySupported:supportsYoy,yoyYears,latestYoyYear:last(yoyYears),
        entities:entityAvailability,commonYears:common,latestCommonYear:last(common),
        primaryYears:entityAvailability[0]?.years ?? [],latestEntityYear:entityAvailability[0]?.latestYear ?? null,
        countryYears:entityAvailability[0]?.kind==='country'?entityAvailability[0].years:[],latestCountryYear:entityAvailability[0]?.kind==='country'?entityAvailability[0].latestYear:null,
        coverage:coverage.map(row=>({year:row.year,observations:Number(row.observations),validYoyPairs:supportsYoy?Number(row.validPairs):null,vintage:row.vintage})),
        generation:{contentVersion:state?.contentVersion??null,runId:state?.updatedRunId??null},
        sourceVintage:state?.maxWbLastUpdated??null,source:'World Bank WDI',
        method:'Committed annual input availability. Group defaults require complete source legs; analytical handlers retain final operation, vintage and cohort validation.'};
    } finally {tx.close();}
    if (content != null && result.generation.contentVersion===content && scopes.get(db)===cache) {
      if (cache.requests.size>=MAX_KEYS) cache.requests.delete(cache.requests.keys().next().value);
      cache.requests.set(key,result);
    }
    return result;
  });
}
