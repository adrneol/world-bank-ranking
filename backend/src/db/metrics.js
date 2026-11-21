/** Opt-in, in-memory client counters. No SQL, arguments, URLs or secrets escape. */
export function observeDatabase(client) {
  const counters = {};
  const reset = () => Object.assign(counters, {
    clientCalls: 0, statements: 0, batches: 0, transactions: 0, commits: 0,
    rollbacks: 0, scriptCalls: 0, rowsReturned: 0, rowsAffected: 0, observationRowsAffected: 0,
    observationStatements: 0, errors: 0, clientMs: 0,
  });
  reset();
  const proxies = new WeakMap();
  function wrap(handle) {
    if (proxies.has(handle)) return proxies.get(handle);
    const proxy = new Proxy(handle, { get(target, name) {
      const method = Reflect.get(target, name, target);
      if (typeof method !== 'function') return method;
      if (!['execute', 'executeMultiple', 'batch', 'transaction', 'commit', 'rollback'].includes(name)) return method.bind(target);
      return async (...args) => {
        counters.clientCalls++;
        if (name === 'batch') counters.batches++;
        if (name === 'transaction') counters.transactions++;
        if (name === 'commit') counters.commits++;
        if (name === 'rollback') counters.rollbacks++;
        const inputs = name === 'batch' ? args[0] : name === 'execute' ? [args[0]] : [];
        const observationWrites = inputs.map(input => {
          const sql = typeof input === 'string' ? input : Array.isArray(input) ? input[0] : input.sql;
          return /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+observations\b/i.test(sql);
        });
        // executeMultiple does not expose parsed statement statistics. Count
        // scripts separately rather than pretending a semicolon split is SQL parsing.
        if (name === 'executeMultiple') counters.scriptCalls++;
        counters.statements += inputs.length;
        counters.observationStatements += observationWrites.filter(Boolean).length;
        const start = performance.now();
        try {
          const value = await method.apply(target, args);
          const results = name === 'batch' ? value : name === 'execute' ? [value] : [];
          results.forEach((result, index) => {
            counters.rowsReturned += result.rows?.length ?? 0;
            counters.rowsAffected += Number(result.rowsAffected ?? 0);
            if (observationWrites[index]) counters.observationRowsAffected += Number(result.rowsAffected ?? 0);
          });
          return name === 'transaction' ? wrap(value) : value;
        } catch (error) { counters.errors++; throw error; }
        finally { counters.clientMs += performance.now() - start; }
      };
    } });
    proxies.set(handle, proxy);
    return proxy;
  }
  return { db: wrap(client), reset, snapshot: () => ({ ...counters }) };
}
