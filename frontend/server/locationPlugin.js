import location from '../api/location.js';

/** Vite is not trusted hosting ingress: supplied geographic headers are ignored. */
export function locationEndpoint() {
  const middleware = (req, res, next) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/api/location') return next();
    location({ method: req.method, headers: {} }, {
      setHeader: (name, value) => res.setHeader(name, value),
      status(code) {
        res.statusCode = code;
        return { json(body) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); } };
      },
    });
  };
  return { name: 'local-country-hint', configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
