/** Concurrent work only; settled results and rejected promises are never retained. */
const scopes = new WeakMap();
export const MAX_ACTIVE_READ_KEYS = 64;
export function singleFlight(scope, key, compute) {
  let pending = scopes.get(scope);
  if (!pending) { pending = new Map(); scopes.set(scope, pending); }
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= MAX_ACTIVE_READ_KEYS) return compute();
  const work = Promise.resolve().then(compute);
  pending.set(key, work);
  const remove = () => { if (pending.get(key) === work) pending.delete(key); };
  work.then(remove, remove);
  return work;
}
