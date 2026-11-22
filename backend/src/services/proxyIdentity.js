import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
export function verifiedProxyIdentity(req, secret = process.env.API_PROXY_SECRET, now = Date.now()) {
  const ip=req.headers['x-research-client'],time=req.headers['x-research-time'],signature=req.headers['x-research-signature'];
  if(secret && Buffer.byteLength(secret)>=32 && typeof ip==='string' && isIP(ip) && /^\d{13}$/.test(time??'') && Math.abs(now-Number(time))<60000 && /^[a-f0-9]{64}$/.test(signature??'')) {
    const expected=createHmac('sha256',secret).update(`${req.method}\n${req.originalUrl}\n${ip}\n${time}`).digest();
    if(timingSafeEqual(expected,Buffer.from(signature,'hex')))return ip;
  }
  return null;
}

export function clientIdentity(req,secret=process.env.API_PROXY_SECRET,now=Date.now()) { return verifiedProxyIdentity(req,secret,now) ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown'; }
