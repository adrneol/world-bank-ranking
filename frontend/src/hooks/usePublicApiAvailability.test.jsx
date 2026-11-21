import { act, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { usePublicApiAvailability } from './usePublicApiAvailability.js';
import { flushReact } from '../test-utils.js';

let cleanup;
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });
const observer = { current: null };
function Discovery({ view }) { const state = usePublicApiAvailability(view); useImperativeHandle(observer, () => state.observe, [state.observe]); return <><h1>Research stays available</h1>{state.enabled ? <a href="/public-data/">Public API</a> : null}</>; }
it('uses backend state on visit, focus and navigation, with failure closed and no render polling', async () => {
  let state = true;
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ publicReadApiEnabled: state }) }));
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  act(() => root.render(<Discovery view="home" />)); await flushReact(act);
  expect(container.querySelector('a')).not.toBeNull();
  const calls = fetch.mock.calls.length;
  act(() => root.render(<Discovery view="home" />)); await flushReact(act);
  expect(fetch).toHaveBeenCalledTimes(calls);
  const newer = performance.now();
  act(() => observer.current({ publicReadApiEnabled: false }, newer));
  expect(container.querySelector('a')).toBeNull();
  act(() => observer.current({ publicReadApiEnabled: true }, newer-1));
  expect(container.querySelector('a')).toBeNull();
  state = false;
  act(() => window.dispatchEvent(new Event('focus'))); await flushReact(act);
  expect(container.querySelector('a')).toBeNull();
  state = true;
  act(() => root.render(<Discovery view="overview" />)); await flushReact(act);
  expect(container.querySelector('a')).not.toBeNull();
  fetch.mockRejectedValue(new Error('offline'));
  act(() => window.dispatchEvent(new Event('online'))); await flushReact(act);
  expect(container.querySelector('a')).toBeNull();
  expect(container.querySelector('h1').textContent).toContain('Research stays available');
});
