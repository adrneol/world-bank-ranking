/**
 * Full country ranking for one year × metric with backend pagination and
 * backend-powered search. Ranks arrive numbered from the backend and are
 * displayed as-is — search matches never renumber anything.
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { METRICS, metricTitle } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { Section, StatusBlock, Pagination, UnavailableState } from '../components/ui.jsx';
import SearchField from '../components/SearchField.jsx';

// Must stay identical to backend parseRankQuery (domain/ranking.js).
// Message-only use: the backend performs the actual rank lookup.
function parseRankQuery(input) {
  const m = /^#?(\d+)$/.exec(String(input ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

const PAGE_SIZE_DEFAULT = 50;

export default function FullRanking({ year, metricKey, country = 'IND' }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // A new year/metric/search starts over at page 1 (backend clamps
  // out-of-range pages anyway, but resetting avoids showing a stale page).
  useEffect(() => {
    setPage(1);
  }, [year, metricKey, country]);

  // Search-as-you-type for the backend-powered search (debounced: the list
  // is remote, so keystrokes must not fire a request each). The Search
  // button / Enter submits immediately; matching semantics stay entirely
  // backend-owned (substring name/ISO3, exact rank, backend numbering).
  // Applied from a timeout (never synchronously in the effect body) so one
  // keystroke never cascades two renders.
  const debouncedInput = useDebouncedValue(searchInput.trim(), 300);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(debouncedInput);
    }, 0);
    return () => clearTimeout(timer);
  }, [debouncedInput]);

  const depsKey = `fullrank:${metricKey}:${year ?? ''}:${page}:${pageSize}:${search}:${country}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.ranking({ indicator: metricKey, year, page, pageSize, search, country }, { signal }),
    depsKey,
    { enabled: year != null && metricKey != null },
  );

  const empty = !loading && !error && data && (data.rows ?? []).length === 0 && !search;
  const unavailable = !loading && !error && data && data.available === false;
  // Ordering claim comes from the registry direction, never a hardcoded
  // "descending": ASC metrics order lower values first; NEUTRAL metrics
  // (quoted FX) are never ranked across currencies.
  const direction = METRICS[metricKey]?.rankingDirection ?? null;
  const orderText =
    direction === 'ASC'
      ? 'raw value ascending (lower values first), ISO3 ascending'
      : direction === 'NEUTRAL'
        ? 'ranking not supported for this metric'
        : 'raw value descending, ISO3 ascending';

  function handlePage(next, nextSize) {
    if (nextSize && nextSize !== pageSize) setPageSize(nextSize);
    setPage(nextSize && nextSize !== pageSize ? 1 : next);
  }

  function submitSearch() {
    setPage(1);
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  return (
    <Section
      id="full-ranking"
      title="Full country ranking"
      subtitle={`${year ?? '—'} · ${metricTitle(metricKey)}. Ordered by the backend: ${orderText}.`}
    >
      <div className="toolbar">
        <SearchField
          id="fullrank-search"
          label="Search country, ISO3, or rank"
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={submitSearch}
          appliedQuery={search}
          onClear={clearSearch}
          placeholder="e.g. India, IND, or 12"
        />
      </div>

      <StatusBlock loading={loading} error={error} empty={empty && !unavailable} onRetry={retry} sectionName="full ranking" />

      {unavailable ? (
        <UnavailableState reason={data.reason} code={data.reason} hint={data.detail ?? undefined} />
      ) : null}

      {!loading && !error && data && search ? (
        <p className="status" role="status">
          {data.search.matchCount} match{data.search.matchCount === 1 ? '' : 'es'} for “{data.search.query}” — ranks shown
          are the authoritative rank numbers.
        </p>
      ) : null}

      {!loading && !error && data && search && data.search.matches.length === 0 && parseRankQuery(search) !== null ? (
        <p className="status" role="status">
          No economy with analytical rank #{parseRankQuery(search)} in this result set.
        </p>
      ) : null}

      {!loading && !error && data && (search ? data.search.matches.length > 0 : data.rows.length > 0) ? (
        <>
          <div className="table-scroll" role="region" aria-label="Full ranking table" tabIndex={0}>
            <table className="table">
              <caption className="sr-only">
                Full ranking {year} {metricTitle(metricKey)}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="num">
                    Rank
                  </th>
                  <th scope="col">Country</th>
                  <th scope="col">ISO3</th>
                  <th scope="col" className="num">
                    Raw value
                  </th>
                  <th scope="col" className="num">
                    Display
                  </th>
                </tr>
              </thead>
              <tbody>
                {(search ? data.search.matches : data.rows).map((r) => (
                  <tr key={`${r.rank}-${r.iso3}`} className={r.isFocus ? 'row-focus' : undefined}>
                    <th scope="row" className="num">
                      {r.rank}
                      {r.isFocus ? <span className="focus-tag">{r.country}</span> : null}
                    </th>
                    <td>{r.country}</td>
                    <td className="mono">{r.iso3}</td>
                    <td className="num mono">{r.rawValueText ?? String(r.rawValue)}</td>
                    <td className="num">{r.displayValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!search ? (
            <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={handlePage} />
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
