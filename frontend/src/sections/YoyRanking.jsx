/**
 * YoY ranking — a SEPARATE concept from level ranking.
 * Countries ordered by backend-calculated percentage change; the denominator
 * counts only valid YoY pairs and is shown explicitly next to the level
 * denominator for comparison.
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { metricTitle } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatYoy } from '../utils/format.js';
import { Section, StatusBlock, Pagination, Field } from '../components/ui.jsx';

export default function YoyRanking({ year, metricKey }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setPage(1);
  }, [year, metricKey]);

  const depsKey = `yoyrank:${metricKey}:${year ?? ''}:${page}:${pageSize}:${search}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.yoyRanking({ indicator: metricKey, year, page, pageSize, search, country: 'IND' }, { signal }),
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
      id="yoy-ranking"
      title="YoY ranking (separate from level ranking)"
      subtitle={`${year ?? '—'} · ${metricTitle(metricKey)}. Ordered by GDP-per-capita percentage change — not by value.`}
    >
      {!loading && !error && data ? (
        <p className="denominators" role="status">
          YoY denominator: <strong>{data.total}</strong> valid pairs
          {data.focus ? (
            <>
              {' '}· India YoY rank: <strong>{data.focus.rank}</strong>
            </>
          ) : (
            ' · India has no calculable YoY for this year'
          )}
        </p>
      ) : null}

      <form className="toolbar" onSubmit={submitSearch} role="search" aria-label="Search YoY ranking">
        <Field label="Search country or ISO3" htmlFor="yoyrank-search">
          <span className="search-row">
            <input
              id="yoyrank-search"
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

      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="YoY ranking" />

      {!loading && !error && data && (search ? data.search.matches.length > 0 : data.rows.length > 0) ? (
        <>
          <div className="table-scroll" role="region" aria-label="YoY ranking table" tabIndex={0}>
            <table className="table">
              <caption className="sr-only">
                YoY ranking {year} {metricTitle(metricKey)}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="num">
                    YoY rank
                  </th>
                  <th scope="col">Country</th>
                  <th scope="col">ISO3</th>
                  <th scope="col" className="num">
                    Previous raw
                  </th>
                  <th scope="col" className="num">
                    Current raw
                  </th>
                  <th scope="col" className="num">
                    YoY %
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
                    <td className="num mono" title={`Display: ${r.previousValueDisplay}`}>
                      {r.previousValueText}
                    </td>
                    <td className="num mono" title={`Display: ${r.currentValueDisplay}`}>
                      {r.currentValueText}
                    </td>
                    <td className="num">{formatYoy(r.yoyPercent, r.yoyDisplay)}</td>
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
