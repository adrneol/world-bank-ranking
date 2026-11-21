// Runs on the frontend host. Vercel supplies this country header at ingress.
// It is a convenience hint only. The application validates it against WDI.
export default function location(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ iso2: null });
  const country = process.env.VERCEL === '1' ? req.headers['x-vercel-ip-country'] : null;
  const iso2 = typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null;
  return res.status(200).json({ iso2, source: iso2 ? 'frontend-edge' : 'unavailable' });
}
