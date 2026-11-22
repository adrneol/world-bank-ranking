import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentHandler } from '../../frontend/api/public-documents.js';
import { DOCUMENT_SHELL } from '../../frontend/server/documentHtml.js';
import { publicationState } from '../../frontend/server/publication.js';

function response(){return {statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},end(body){this.body=body;}};}
test('function distinguishes enabled, disabled and invalid authority without frontend overrides',async()=>{
  const old=process.env.BACKEND_API_ORIGIN;
  try{
    process.env.BACKEND_API_ORIGIN='https://backend.example/';
    for(const body of [{publicReadApiEnabled:true},{publicReadApiEnabled:false},{publicReadApiEnabled:'true'},{}]){
      const handler=createDocumentHandler({loadTemplate:async()=>DOCUMENT_SHELL,fetcher:async()=>({ok:true,json:async()=>body})});
      for(const resource of ['docs','catalog']){
        const res=response();await handler({method:'GET',query:{resource}},res);
        assert.equal(res.statusCode,body.publicReadApiEnabled===true?200:body.publicReadApiEnabled===false?404:503);
        assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['CDN-Cache-Control'],'no-store');
        if(resource==='catalog')assert.doesNotThrow(()=>JSON.parse(res.body));
        else assert.match(res.body,/<html/);
      }
    }
    delete process.env.BACKEND_API_ORIGIN;const res=response();await createDocumentHandler()({method:'GET',query:{resource:'docs'}},res);
    assert.equal(res.statusCode,503);assert.match(res.body,/Try again/);assert.match(res.body,/Return to Home/);
  }finally{if(old==null)delete process.env.BACKEND_API_ORIGIN;else process.env.BACKEND_API_ORIGIN=old;}
});
test('missing packaged HTML gives intentional 503 HTML, JSON resources stay independent, and HEAD stays empty',async()=>{
  const old=process.env.BACKEND_API_ORIGIN;process.env.BACKEND_API_ORIGIN='https://backend.example';
  try{
    const handler=createDocumentHandler({loadTemplate:async()=>{throw Error('sensitive internal asset path');},fetcher:async()=>({ok:true,json:async()=>({publicReadApiEnabled:true})})});
    for(const method of ['GET','HEAD']){const res=response();await handler({method,query:{resource:'docs'}},res);assert.equal(res.statusCode,503);assert.match(res.headers['Content-Type'],/text\/html/);assert.equal(res.headers['Retry-After'],'5');if(method==='HEAD')assert.equal(res.body,undefined);else{assert.match(res.body,/Public data service temporarily unavailable/);assert.ok(!res.body.includes('sensitive internal asset path'));}}
    const res=response();await handler({method:'GET',query:{resource:'catalog'}},res);assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.body).operations.length,31);
  }finally{if(old==null)delete process.env.BACKEND_API_ORIGIN;else process.env.BACKEND_API_ORIGIN=old;}
});
test('authority retries only transient failures and does not retain a settled enabled decision',async()=>{
  let calls=0;
  assert.equal(await publicationState('https://backend.example',async()=>++calls===1?{ok:false,status:503}:{ok:true,json:async()=>({publicReadApiEnabled:true})}),'enabled');assert.equal(calls,2);
  assert.equal(await publicationState('https://backend.example',async()=>({ok:true,json:async()=>({publicReadApiEnabled:false})})),'disabled');
  calls=0;assert.equal(await publicationState('https://backend.example',async()=>{calls++;return {ok:false,status:429};}),'unavailable');assert.equal(calls,1);
});
