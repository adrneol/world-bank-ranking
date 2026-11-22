import { createApiForward } from '../server/apiForward.js';
const forward=createApiForward();
export default function research(req,res) {
 const path=req.query?._researchPath;
 if(typeof path==='string') {
  const query=(req.url.split('?')[1]??'').split('&').filter(part=>part.split('=')[0]!=='_researchPath').join('&');
  req.url='/api/'+path+(query?'?'+query:'');
 }
 return forward(req,res);
}
