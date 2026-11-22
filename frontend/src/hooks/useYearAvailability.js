import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

/** Publication-token and version tagged; no stale economy/indicator can choose a year. */
export function useYearAvailability(params, generation, enabled) {
  const paramsKey=JSON.stringify(params);
  const {token,contentVersion,provider}=generation;
  const [retryToken,setRetryToken]=useState(0);
  const [record,setRecord]=useState(null);
  const settled=useRef(null);
  const matches=record?.paramsKey===paramsKey && record.token===token && record.retryToken===retryToken;
  // A scoped response is its own committed snapshot. A newer response can
  // legitimately follow older global metadata (or a different serving target).
  const compatible=matches && record.data && ((record.provider===provider && record.contentVersion===contentVersion) ||
    (record.data.generation?.contentVersion===contentVersion && (!provider||record.data.database?.provider===provider)));
  const failed=matches && record.error && record.contentVersion===contentVersion && record.provider===provider;
  useEffect(()=>{
    const last=settled.current;
    if(!enabled || (last?.paramsKey===paramsKey && last.token===token && last.retryToken===retryToken &&
      last.data && ((last.provider===provider && last.contentVersion===contentVersion) ||
        (last.data.generation?.contentVersion===contentVersion && (!provider||last.data.database?.provider===provider))))) return undefined;
    const controller=new AbortController();
    const tag={paramsKey,token,contentVersion,provider,retryToken};
    Promise.resolve().then(()=>api.availability(JSON.parse(paramsKey),{signal:controller.signal,timeoutMs:12000,passive:true,recover:true}))
      .then(data=>{
        if(controller.signal.aborted)return;
        if(data?.metricKey!==JSON.parse(paramsKey).indicator || !['years','countryYears','commonYears','yoyYears'].every(name=>Array.isArray(data[name])&&data[name].every(Number.isInteger)))throw new Error('Published year availability could not be confirmed.');
        const next={...tag,data};settled.current=next;setRecord(next);
      }).catch(error=>{if(!controller.signal.aborted)setRecord({...tag,error});});
    return()=>controller.abort();
  },[paramsKey,token,contentVersion,provider,retryToken,enabled]);
  const retry=useCallback(()=>setRetryToken(value=>value+1),[]);
  return {data:compatible?record.data:null,pending:enabled && !compatible && !failed,error:failed?record.error:null,retry};
}
