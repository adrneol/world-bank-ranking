/**
 * LOCAL STUB OF THE WORLD BANK INDICATORS API.
 *
 * Tests must never touch the live API (specification section 25), so the client is
 * pointed at this in-process server via WORLD_BANK_API_BASE_URL. It serves the same
 * envelope shapes the real API returns - including the HTTP-200 error envelope -
 * and can inject failures (5xx, 429 + Retry-After, invalid JSON) and pagination
 * anomalies. Uses only the versioned fixtures: no network, fully deterministic.
 */

import http from 'node:http';
import {
  countryMetadataEnvelope,
  indicatorMetadataRow,
  seriesEnvelope,
  snapshot,
} from '../fixtures/snapshot.js';
import {
  TOTAL_GDP_LAST_UPDATED,
  TOTAL_GDP_METRIC_KEYS,
  totalGdpIndicatorMetadataRow,
  totalGdpMetricKeyForCode,
  totalGdpRows,
} from '../fixtures/totalGdp.js';
import {
  PHASE5_LAST_UPDATED,
  phase5IndicatorMetadataRow,
  phase5MetricKeyForCode,
  phase5Rows,
} from '../fixtures/phase5.js';

/** Point the application at this stub. Call BEFORE importing src modules. */
export function useStubBaseUrl(baseUrl) {
  process.env.WORLD_BANK_API_BASE_URL = baseUrl;
}

function collectionEnvelope(rows, params, meta = {}) {
  const perPage = Number(params.per_page ?? rows.length) || rows.length;
  const page = Number(params.page ?? 1) || 1;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const start = (page - 1) * perPage;
  return [
    {
      page,
      pages,
      per_page: perPage,
      total: meta.total ?? rows.length,
      sourceid: '2',
      lastupdated: meta.lastupdated ?? null,
    },
    rows.slice(start, start + perPage),
  ];
}

export async function startStubWorldBank(options = {}) {
  const state = {
    requests: [],
    failure: null,
    failMatching: null,
    metaTotalOffset: options.metaTotalOffset ?? 0,
    seriesRowsFor: options.seriesRowsFor ?? null,
    countryRowsFor: options.countryRowsFor ?? null,
    invalidJson: false,
    // Upstream release vintage reported in the series envelope's meta block.
    // null = use each metric family's fixture vintage; a string overrides it
    // for every series, so a test can simulate the World Bank advancing
    // `lastupdated` between refreshes (a new release that changed no values).
    seriesLastUpdated: null,
  };

  // Per-capita metrics are served from the committed versioned snapshot; the
  // Total GDP subject is served from its own offline fixture (the versioned
  // snapshot is deliberately never regenerated for the new subject), and the
  // Phase-5 families from theirs (same rule: live-verified anchors plus
  // synthetic companions, aggregates included where published).
  const isSnapshotMetric = (metricKey) => Boolean(snapshot.indicators[metricKey]);
  const isTotalGdpMetric = (metricKey) => TOTAL_GDP_METRIC_KEYS.includes(metricKey);
  const envelopeFor = (metricKey) => {
    if (isSnapshotMetric(metricKey)) return seriesEnvelope(metricKey);
    if (isTotalGdpMetric(metricKey)) {
      const rows = totalGdpRows(metricKey);
      return [
        { page: 1, pages: 1, per_page: rows.length, total: rows.length, sourceid: '2', lastupdated: TOTAL_GDP_LAST_UPDATED },
        rows,
      ];
    }
    const rows = phase5Rows(metricKey);
    return [
      { page: 1, pages: 1, per_page: rows.length, total: rows.length, sourceid: '2', lastupdated: PHASE5_LAST_UPDATED },
      rows,
    ];
  };
  const metadataRowFor = (metricKey) => {
    if (isSnapshotMetric(metricKey)) return indicatorMetadataRow(metricKey);
    if (isTotalGdpMetric(metricKey)) return totalGdpIndicatorMetadataRow(metricKey);
    return phase5IndicatorMetadataRow(metricKey);
  };
  const lastUpdatedFor = (metricKey) =>
    isSnapshotMetric(metricKey)
      ? snapshot.indicators[metricKey].lastUpdated
      : isTotalGdpMetric(metricKey)
        ? TOTAL_GDP_LAST_UPDATED
        : PHASE5_LAST_UPDATED;

  const metricKeyForCode = (code) =>
    Object.keys(snapshot.indicators).find(
      (key) => snapshot.indicators[key].indicatorCode === code,
    ) ?? totalGdpMetricKeyForCode(code) ?? phase5MetricKeyForCode(code);

  const respond = (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const params = Object.fromEntries(url.searchParams.entries());
    state.requests.push({ path: url.pathname, params });

    const failWith = (spec) => {
      const headers = { 'Content-Type': 'text/plain' };
      if (spec.retryAfter !== undefined) {
        headers['Retry-After'] = String(spec.retryAfter);
      }
      res.writeHead(spec.status, headers);
      res.end(spec.body ?? 'stub failure');
    };
    // Targeted failure first: only requests whose path contains the substring
    // fail (lets one indicator's series fail while the rest succeed).
    if (
      state.failMatching &&
      state.failMatching.times > 0 &&
      url.pathname.includes(state.failMatching.substring)
    ) {
      state.failMatching.times -= 1;
      failWith(state.failMatching);
      return;
    }
    if (state.failure && state.failure.times > 0) {
      state.failure.times -= 1;
      failWith(state.failure);
      return;
    }

    const send = (payload) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(options.responseFor?.({ path: url.pathname, params, payload }) ?? payload));
    };

    if (state.invalidJson) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('<!doctype html><html>not json</html>');
      return;
    }

    const path = url.pathname.replace(/^\/v2/, '');

    if (path === '/country') {
      const [meta, baseRows] = countryMetadataEnvelope();
      // Transformed row sets report their own length so the completeness
      // check still passes; untransformed behavior is byte-identical.
      const rows = state.countryRowsFor ? state.countryRowsFor(baseRows) : baseRows;
      const total = (state.countryRowsFor ? rows.length : meta.total) + state.metaTotalOffset;
      send([{ ...meta, total }, rows]);
      return;
    }

    const seriesMatch = /^\/country\/all\/indicator\/(.+)$/.exec(path);
    if (seriesMatch) {
      const metricKey = metricKeyForCode(decodeURIComponent(seriesMatch[1]));
      if (!metricKey) {
        // Exactly the envelope the real API returns (with HTTP 200).
        send([{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }]);
        return;
      }
      const [baseMeta, baseRows] = envelopeFor(metricKey);
      const rows = state.seriesRowsFor ? state.seriesRowsFor(metricKey, baseRows) : baseRows;
      const dateFilter = params.date ? String(params.date).split(':') : null;
      const filtered = dateFilter
        ? rows.filter((row) => {
            const year = Number.parseInt(row.date, 10);
            const from = Number.parseInt(dateFilter[0], 10);
            const to = Number.parseInt(dateFilter[1] ?? dateFilter[0], 10);
            return year >= from && year <= to;
          })
        : rows;
      send(
        collectionEnvelope(filtered, params, {
          total: filtered.length + state.metaTotalOffset,
          lastupdated: state.seriesLastUpdated ?? baseMeta.lastupdated,
        }),
      );
      return;
    }

    const indicatorMatch = /^(?:\/source\/2)?\/indicator\/(.+)$/.exec(path);
    if (indicatorMatch) {
      const metricKey = metricKeyForCode(decodeURIComponent(indicatorMatch[1]));
      if (!metricKey) {
        send([{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }]);
        return;
      }
      send([
        { page: 1, pages: 1, per_page: 5, total: 1, sourceid: '2', lastupdated: lastUpdatedFor(metricKey) },
        [metadataRowFor(metricKey)],
      ]);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('stub: unknown endpoint');
  };

  let baseUrl;
  let close;
  if (options.inProcess) {
    // Substitute only the upstream transport. The real client still builds
    // URLs, parses Fetch responses, and runs retry and publication logic.
    const originalFetch = globalThis.fetch;
    const origin = 'http://world-bank-fixture.invalid';
    baseUrl = `${origin}/v2`;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== origin) {
        if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
        throw new Error('External fetch is disabled for this fixture');
      }
      init?.signal?.throwIfAborted();
      return new Promise((resolve) => {
        let status;
        let headers;
        respond({ url: url.pathname + url.search }, {
          writeHead(code, values) { status = code; headers = values; },
          end(body) { resolve(new Response(body, { status, headers })); },
        });
      });
    };
    close = () => { globalThis.fetch = originalFetch; };
  } else {
    const server = http.createServer(respond);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/v2`;
    close = () => new Promise((resolve) => server.close(resolve));
  }

  return {
    baseUrl,
    state,
    requestCount: () => state.requests.length,
    /** How many requests hit a path containing `substring` (e.g. one series). */
    requestsFor(substring) {
      return state.requests.filter((r) => String(r.path).includes(substring)).length;
    },
    reset() {
      state.requests.length = 0;
      state.failure = null;
      state.failMatching = null;
      state.metaTotalOffset = 0;
      state.invalidJson = false;
      state.seriesLastUpdated = null;
    },
    /**
     * Override the upstream release vintage (`lastupdated`) reported in every
     * series envelope. Pass null to restore the per-metric fixture vintage.
     * Simulates the World Bank publishing a new release whose VALUES are
     * unchanged but whose metadata stamp has advanced.
     */
    setSeriesLastUpdated(value) {
      state.seriesLastUpdated = value ?? null;
    },
    /** Fail the next `times` requests with the given status (and Retry-After). */
    failNext({ status = 500, times = 1, retryAfter, body } = {}) {
      state.failure = { status, times, retryAfter, body };
    },
    /**
     * Fail the next `times` requests whose URL path contains `substring`
     * (e.g. one indicator's series path). All other requests succeed, so a
     * partial refresh (some indicators up, some down) can be staged.
     */
    failNextMatching({ status = 500, times = 1, substring, retryAfter, body } = {}) {
      state.failMatching = { status, times, substring, retryAfter, body };
    },
    /** Serve rows with a meta.total larger than the rows actually returned. */
    setMetaTotalOffset(offset) {
      state.metaTotalOffset = offset;
    },
    sendInvalidJson(next = true) {
      state.invalidJson = next;
    },
    close,
  };
}

export default { startStubWorldBank, useStubBaseUrl };