const retryDelays = [900, 2400, 5500].map(delay => delay * (0.8 + Math.random() * 0.4));

function transient(error) {
  if (error.status != null) return [408, 502, 503, 504].includes(error.status);
  return ['NETWORK_ERROR', 'TIMEOUT', 'DATA_LOADING', 'DATA_SERVICE_STARTING'].includes(error.code);
}

function wait(delay, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      globalThis.window?.removeEventListener('online', online);
    }
    function abort() { done(); reject(signal.reason); }
    function online() {
      if (globalThis.navigator?.onLine === false) return;
      done();
      resolve(true);
    }
    const timer = setTimeout(() => { done(); resolve(globalThis.navigator?.onLine !== false); }, delay);
    signal?.addEventListener('abort', abort, { once: true });
    globalThis.window?.addEventListener('online', online);
  });
}

export async function recoverRead(read, signal) {
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const result = await read();
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= retryDelays.length || !transient(error)) throw error;
      const delay = globalThis.navigator?.onLine === false ? 15000 : retryDelays[attempt];
      if (!await wait(delay, signal)) throw error;
    }
  }
}
