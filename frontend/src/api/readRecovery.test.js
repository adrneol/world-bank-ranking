import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client.js';
import { errorResponse, stubFetch } from '../test-utils.js';

let stub;
afterEach(() => {
  stub?.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('bounded read recovery', () => {
  it.each([502, 503, 504, 'reset', 'timeout'])('recovers from %s and shares concurrent reads', async failure => {
    vi.useFakeTimers();
    let calls = 0;
    stub = stubFetch([['/api/data-status', () => {
      if (++calls > 1) return { ok: true, json: async () => ({ fresh: true }) };
      if (failure === 'reset') throw new TypeError('connection reset');
      if (failure === 'timeout') return new Promise(() => {});
      return errorResponse(failure, 'UPSTREAM', 'Temporary');
    }]]);
    const options = { recover: true, timeoutMs: 30 };
    const results = Promise.all([api.dataStatus(options), api.dataStatus(options)]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await results).toEqual([{ fresh: true }, { fresh: true }]);
    expect(calls).toBe(2);
  });

  it.each([[401, 1], [503, 4]])('ends HTTP %s after %s attempts', async (status, attempts) => {
    vi.useFakeTimers();
    stub = stubFetch([['/api/data-status', () => errorResponse(status, 'ERROR', 'Unavailable')]]);
    const result = api.dataStatus({ recover: true }).catch(error => error);
    await vi.advanceTimersByTimeAsync(13000);
    expect(await result).toMatchObject({ status });
    expect(stub.calls).toHaveLength(attempts);
  });

  it('resumes offline reads on reconnect', async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    let calls = 0;
    stub = stubFetch([['/api/data-status', () => ++calls === 1
      ? errorResponse(503, 'ERROR', 'Offline')
      : { ok: true, json: async () => ({ fresh: true }) }]]);
    const result = api.dataStatus({ recover: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(await result).toEqual({ fresh: true });
  });

  it('cancels the scheduled retry when superseded by a manual read', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    stub = stubFetch([['/api/data-status', () => ++calls === 1
      ? errorResponse(502, 'ERROR', 'Temporary')
      : { ok: true, json: async () => ({ fresh: true }) }]]);
    const first = api.dataStatus({ recover: true, signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect((await first).name).toBe('AbortError');
    expect(await api.dataStatus({ recover: true })).toEqual({ fresh: true });
    await vi.advanceTimersByTimeAsync(13000);
    expect(calls).toBe(2);
  });
});
