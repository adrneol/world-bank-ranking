import { createContext, useCallback, useContext, useState, useSyncExternalStore } from 'react';

export const ResearchPreferenceContext=createContext(null);
export function createPreferenceStore() {
  const values=new Map(),listeners=new Set();
  return {get:key=>values.get(key),has:key=>values.has(key),
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    set(key,value){values.delete(key);values.set(key,value);if(values.size>128)values.delete(values.keys().next().value);listeners.forEach(listener=>listener());}};
}
export function useResearchPreference(name,initial) {
  const context=useContext(ResearchPreferenceContext);
  const [fallback]=useState(()=>createPreferenceStore());
  const [initialValue]=useState(()=>initial);
  const store=context?.store??fallback;
  const key=`${context?.scope??'standalone'}:${name}`;
  const get=useCallback(()=>store.has(key)?store.get(key):initialValue,[store,key,initialValue]);
  const value=useSyncExternalStore(store.subscribe,get,get);
  const set=useCallback(next=>store.set(key,typeof next==='function'?next(get()):next),[store,key,get]);
  return [value,set];
}
