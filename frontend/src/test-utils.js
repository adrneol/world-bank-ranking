/**
 * Shared fetch stubbing for frontend tests (no production effect).
 *
 * Routes match by URL substring in order; each entry maps to a payload
 * object (served as `{ ok: true, json() }`) or a handler function
 * receiving the URL and returning such a response. Unmatched requests
 * fail loudly so missing mocks surface instead of hanging.
 */

export function stubFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    calls.push(href);
    for (const [match, respond] of routes) {
      if (href.includes(match)) {
        if (typeof respond === 'function') return respond(href, options);
        return { ok: true, status: 200, headers: new Headers(), json: async () => respond };
      }
    }
    throw new Error(`Unmocked fetch: ${href}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

export function errorResponse(status, code, message) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({ error: { message, code } }),
  };
}

/** Flush pending React updates/effects (multiple rounds for fetch chains). */
export async function flushReact(act, rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {});
  }
}

/** Set a text/search input value the way React's onChange expects. */
export function setInputValue(input, value) {
  const prototypeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (prototypeSetter) prototypeSetter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}
