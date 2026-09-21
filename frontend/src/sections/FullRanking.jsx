/**
 * Full country ranking for one year × metric with backend pagination and
 * backend-powered search. Ranks arrive numbered from the backend and are
 * displayed as-is — search matches never renumber anything.
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { metricTitle } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { Section, StatusBlock, Pagination, Field } from '../components/ui.jsx';

const PAGE_SIZE_DEFAULT = 50;

export default function FullRanking({ year, metricKey }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // A new year/metric/search starts over at page 1 (backend clamps
  // out-of-range pages anyway, but resetting avoids showing a stale page).
  useEffect(() => {
    setPage(1);
  }, [year, metricKey]);

  const depsKey = `fullrank:${metricKey}:${year ?? ''}:${page}:${pageSize}:${search}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.ranking({ indicator: metricKey, year, page, pageSize, search, country: 'IND' }, { signal }),
    depsKey,
    { enabled: year != null && metricKey != null },
  );

  const empty = !loading && !error && data && (data.rows ?? []).length === 0 && !search;

  function handlePage(next, nextSize) {
    if (nextSize && nextSize !== pageSize) setPageSize(nextSize);
    setPage(nextSize && nextSize !== pageSize ? 1 : next);
  }

  function submitSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <Section
      id="full-ranking"
      title="Full country ranking"
      subtitle={`${year ?? '—'} · ${metricTitle(metricKey)}. Ordered by the backend: raw value descending, ISO3 ascending.`}
    >
      <form className="toolbar" onSubmit={submitSearch} role="search" aria-label="Search ranking">
        <Field label="Search country or ISO3" htmlFor="fullrank-search">
          <span className="search-row">
            <input
              id="fullrank-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="e.g. India or IND"
              autoComplete="off"
            />
            <button type="submit" className="btn btn-secondary">
              Search
            </button>
            {search ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setSearchInput('');
                  setSearch('');
                  setPage(1);
                }}
              >
                Clear
              </button>
            ) : null}
          </span>
        </Field>
      </form>

      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="full ranking" />

      {!loading && !error && data && search ? (
        <p className="status" role="status">
          {data.search.matchCount} match{data.search.matchCount === 1 ? '' : 'es'} for “{data.search.query}” — ranks shown
          are the authoritative rank numbers.
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
                      {r.isFocus ? <span className="focus-tag">India</span> : null}
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
