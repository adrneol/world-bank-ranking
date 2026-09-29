/**
 * API CLIENT IN-FLIGHT DEDUPE TESTS (Phase 7B).
 *
 * Identical concurrent GETs must share one fetch with observably identical
 * per-caller semantics: own payload copies, own timeouts, own aborts.
 * POSTs and already-aborted callers never share.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, setApiBaseUrl } from './client.js';

function mockFetch(impl) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (...args) => {
    calls.push(args);
    return impl(...args);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });

afterEach(() => {
  setApiBaseUrl(null);
  vi.useRealTimers();
});

describe('in-flight GET deduplication', () => {
  it('twin identical GETs share one fetch with independent payload copies', async () => {
    const stub = mockFetch(async () => ok({ years: [2000, 2001] }));
    try {
      const [a, b] = await Promise.all([api.years(), api.years()]);
      expect(stub.calls.length).toBe(1);
      expect(a).toEqual({ years: [2000, 2001] });
      expect(b).toEqual({ years: [2000, 2001] });
      expect(a).not.toBe(b);
    } finally {
      stub.restore();
    }
  });

  it('aborting one twin leaves the other resolving; fetch runs once', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const stub = mockFetch(async (_url, _options) => {
      await gate;
      return ok({ v: 1 });
    });
    const c1 = new AbortController();
    const c2 = new AbortController();
    try {
      const p1 = api.years({ signal: c1.signal });
      const p2 = api.years({ signal: c2.signal });
      c1.abort();
      await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
      release();
      await expect(p2).resolves.toEqual({ v: 1 });
      expect(stub.calls.length).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('aborting all twins aborts the shared fetch', async () => {
    let observedSignal = null;
    const stub = mockFetch(async (url, options) => {
      observedSignal = options.signal;
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')), { once: true });
      });
      return ok({});
    });
    const c1 = new AbortController();
    const c2 = new AbortController();
    try {
      const p1 = api.years({ signal: c1.signal });
      const p2 = api.years({ signal: c2.signal });
      c1.abort();
      c2.abort();
      await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
      await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
      expect(observedSignal.aborted).toBe(true);
      expect(stub.calls.length).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('different URLs and POSTs are never shared', async () => {
    const stub = mockFetch(async () => ok({}));
    try {
      await Promise.all([api.years(), api.indicators()]);
      expect(stub.calls.length).toBe(2);
      await Promise.all([
        api.refresh({}, { timeoutMs: 50 }).catch(() => {}),
        api.refresh({}, { timeoutMs: 50 }).catch(() => {}),
      ]);
      expect(stub.calls.length).toBe(4);
    } finally {
      stub.restore();
    }
  });

  it('shared HTTP errors reject every waiter identically', async () => {
    const stub = mockFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'boom', code: 'INTERNAL_ERROR' } }),
    }));
    try {
      const [r1, r2] = await Promise.allSettled([api.years(), api.years()]);
      expect(stub.calls.length).toBe(1);
      expect(r1.status).toBe('rejected');
      expect(r2.status).toBe('rejected');
      expect(r1.reason.status).toBe(500);
      expect(r2.reason.code).toBe('INTERNAL_ERROR');
    } finally {
      stub.restore();
    }
  });

  it('timeouts stay per waiter', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const stub = mockFetch(async () => {
      await gate;
      return ok({ v: 7 });
    });
    try {
      const slow = api.years({ timeoutMs: 5000 });
      const fast = api.years({ timeoutMs: 20 });
      await expect(fast).rejects.toMatchObject({ code: 'TIMEOUT' });
      release();
      await expect(slow).resolves.toEqual({ v: 7 });
      expect(stub.calls.length).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it('sequential identical GETs are not shared (in-flight only)', async () => {
    const stub = mockFetch(async () => ok({}));
    try {
      await api.years();
      await api.years();
      expect(stub.calls.length).toBe(2);
    } finally {
      stub.restore();
    }
  });

  it('an abandoned hung fetch never poisons later identical requests', async () => {
    const stub = mockFetch(() => new Promise(() => {}));
    const c1 = new AbortController();
    try {
      const pending = api.years({ signal: c1.signal });
      c1.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(stub.calls.length).toBe(1);
    } finally {
      stub.restore();
    }
    const stub2 = mockFetch(async () => ok({ years: [2000] }));
    try {
      await expect(api.years()).resolves.toEqual({ years: [2000] });
      expect(stub2.calls.length).toBe(1);
    } finally {
      stub2.restore();
    }
  });
});
