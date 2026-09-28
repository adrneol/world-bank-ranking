import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushReact, setInputValue, stubFetch } from '../test-utils.js';
import FullRanking from './FullRanking.jsx';

const ALL = [
  { rank: 5, iso3: 'IND', country: 'India', isFocus: true, rawValueText: '800', displayValue: '800' },
  { rank: 12, iso3: 'USA', country: 'United States', isFocus: false, rawValueText: '25000', displayValue: '25000' },
  { rank: 30, iso3: 'CHN', country: 'China', isFocus: false, rawValueText: '12000', displayValue: '12000' },
];

function rankingResponse(href) {
  const url = new URL(href, 'http://localhost');
  const search = url.searchParams.get('search') ?? '';
  const trimmed = search.trim();
  const rankMatch = /^#?(\d+)$/.exec(trimmed);
  const matches = !trimmed
    ? []
    : rankMatch
      ? ALL.filter((r) => r.rank === Number(rankMatch[1]))
      : ALL.filter(
        (r) => r.country.toLowerCase().includes(trimmed.toLowerCase()) || r.iso3.toLowerCase().includes(trimmed.toLowerCase()),
      );
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      rows: ALL,
      page: 1,
      pages: 1,
      total: ALL.length,
      pageSize: 50,
      search: { query: search || null, matchCount: matches.length, matches },
    }),
  };
}

function renderRanking() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<FullRanking year={2020} metricKey="nominal_current" country="IND" />);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('FullRanking typeahead search', () => {
  let stub = null;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('searches as you type (debounced) with backend matching and preserved ranks', async () => {
    stub = stubFetch([['/api/ranking', rankingResponse]]);
    const { container, cleanup } = renderRanking();
    await flushReact(act);
    expect(container.textContent).toContain('India');

    const input = container.querySelector('#fullrank-search');
    act(() => {
      setInputValue(input, 'i');
    });
    // Two timer rounds: the 300ms debounce, then the deferred apply effect.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flushReact(act);
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await flushReact(act);
    const searched = stub.calls.filter((url) => url.includes('search='));
    expect(searched.length).toBeGreaterThan(0);
    expect(searched[searched.length - 1]).toContain('search=i');
    expect(container.textContent).toContain('United States');

    act(() => {
      setInputValue(input, '#12');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flushReact(act);
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await flushReact(act);
    expect(container.textContent).toContain('#12');
    expect(container.textContent).not.toContain('China');
    cleanup();
  });

  it('Search submits immediately and Clear restores the list', async () => {
    stub = stubFetch([['/api/ranking', rankingResponse]]);
    const { container, cleanup } = renderRanking();
    await flushReact(act);
    const input = container.querySelector('#fullrank-search');
    act(() => {
      setInputValue(input, 'chn');
    });
    const searchButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Search');
    act(() => {
      searchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    expect(stub.calls.some((url) => url.includes('search=chn'))).toBe(true);

    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Clear');
    expect(clear).toBeTruthy();
    act(() => {
      clear.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    expect(container.querySelector('#fullrank-search').value).toBe('');
    cleanup();
  });
});
