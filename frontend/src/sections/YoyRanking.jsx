/**
 * YoY ranking — a SEPARATE concept from level ranking.
 * Countries ordered by backend-calculated percentage change; the denominator
 * counts only valid YoY pairs and is shown explicitly next to the level
 * denominator for comparison.
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { METRICS, metricTitle } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { formatYoy } from '../utils/format.js';
import { Section, StatusBlock, Pagination, UnavailableState } from '../components/ui.jsx';
import SearchField from '../components/SearchField.jsx';
import { RankedObservation, RankingSummary, RankingTable } from '../components/RankingEvidence.jsx';

// Must stay identical to backend parseRankQuery (domain/ranking.js).
// Message-only use: the backend performs the actual rank lookup.
function parseRankQuery(input) {
  const m = /^#?(\d+)$/.exec(String(input ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export default function YoyRanking({ year, metricKey, country, focusName }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setPage(1);
  }, [year, metricKey]);

  // Search-as-you-type for the backend-powered search (debounced: the list
  // is remote, so keystrokes must not fire a request each). Matching
  // semantics stay entirely backend-owned (substring name/ISO3, exact YoY
  // rank, backend numbering). Applied from a timeout (never synchronously
  // in the effect body) so one keystroke never cascades two renders.
  const debouncedInput = useDebouncedValue(searchInput.trim(), 300);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(debouncedInput);
    }, 0);
    return () => clearTimeout(timer);
  }, [debouncedInput]);

  const depsKey = `yoyrank:${metricKey}:${year ?? ''}:${page}:${pageSize}:${search}:${country}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.yoyRanking({ indicator: metricKey, year, page, pageSize, search, country }, { signal }),
    depsKey,
    { enabled: year != null && metricKey != null },
  );

  const empty = !loading && !error && data && (data.rows ?? []).length === 0 && !search;
  const displayName = data?.focus?.country ?? focusName;

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
      id="yoy-ranking"
      title="Year-over-year ranking"
      subtitle={`${year ?? '—'} · ${metricTitle(metricKey)} · Ranked by annual percentage change`}
    >
      {!loading && !error && data ? (
        <RankingSummary country={displayName} rank={data.focus?.rank} denominator={data.total} denominatorLabel="Valid year pairs"
          value={data.focus ? formatYoy(data.focus.yoyPercent, data.focus.yoyDisplay) : 'No calculable YoY'}
          previous={data.focus?.previousValueDisplay ?? data.focus?.previousValueText}
          current={data.focus?.currentValueDisplay ?? data.focus?.currentValueText} />
      ) : null}

      <div className="toolbar">
        <SearchField
          id="yoyrank-search"
          label="Search country, ISO3, or YoY rank"
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={submitSearch}
          appliedQuery={search}
          onClear={clearSearch}
          placeholder="Country name, ISO3, or YoY rank"
        />
      </div>

      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="YoY ranking" />

      {!loading && !error && data && data.available === false ? (
        <UnavailableState
          reason={data.reason}
          code={data.reason}
          hint="Year-over-year percent change is not defined for this metric — see the level ranking instead."
        />
      ) : null}

      {!loading && !error && data && search && data.search.matches.length === 0 && parseRankQuery(search) !== null ? (
        <p className="status" role="status">
          No economy with YoY rank #{parseRankQuery(search)} in this result set.
        </p>
      ) : null}

      {!loading && !error && data && (search ? data.search.matches.length > 0 : data.rows.length > 0) ? (
        <>
          <RankingTable label="YoY ranking table">
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
                    Previous observation
                  </th>
                  <th scope="col" className="num">
                    Current observation
                  </th>
                  <th scope="col" className="num">
                    {METRICS[metricKey]?.observationType === 'QUOTED_RATE' ? 'Annual movement' : 'YoY %'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(search ? data.search.matches : data.rows).map((r) => (
                  <tr key={`${r.rank}-${r.iso3}`} className={r.isFocus ? 'row-focus' : undefined}>
                    <th scope="row" className="num">
                      {r.rank}
                    </th>
                    <td>{r.country}{r.isFocus ? <span className="sr-only"> (selected economy)</span> : null}</td>
                    <td className="mono">{r.iso3}</td>
                    <td className="num">
                      <RankedObservation display={r.previousValueDisplay} exact={r.previousValueText} />
                    </td>
                    <td className="num">
                      <RankedObservation display={r.currentValueDisplay} exact={r.currentValueText} />
                    </td>
                    <td className="num">{formatYoy(r.yoyPercent, r.yoyDisplay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RankingTable>
          {!search ? (
            <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={handlePage} />
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
