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
  totalGdpIndicatorMetadataRow,
  totalGdpMetricKeyForCode,
  totalGdpRows,
} from '../fixtures/totalGdp.js';

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
    metaTotalOffset: options.metaTotalOffset ?? 0,
    seriesRowsFor: options.seriesRowsFor ?? null,
    invalidJson: false,
  };

  // Per-capita metrics are served from the committed versioned snapshot; the
  // Total GDP subject is served from its own offline fixture (the versioned
  // snapshot is deliberately never regenerated for the new subject).
  const isSnapshotMetric = (metricKey) => Boolean(snapshot.indicators[metricKey]);
  const envelopeFor = (metricKey) => {
    if (isSnapshotMetric(metricKey)) return seriesEnvelope(metricKey);
    const rows = totalGdpRows(metricKey);
    return [
      { page: 1, pages: 1, per_page: rows.length, total: rows.length, sourceid: '2', lastupdated: TOTAL_GDP_LAST_UPDATED },
      rows,
    ];
  };
  const metadataRowFor = (metricKey) =>
    isSnapshotMetric(metricKey) ? indicatorMetadataRow(metricKey) : totalGdpIndicatorMetadataRow(metricKey);

  const metricKeyForCode = (code) =>
    Object.keys(snapshot.indicators).find(
      (key) => snapshot.indicators[key].indicatorCode === code,
    ) ?? totalGdpMetricKeyForCode(code);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const params = Object.fromEntries(url.searchParams.entries());
    state.requests.push({ path: url.pathname, params });

    if (state.failure && state.failure.times > 0) {
      state.failure.times -= 1;
      const headers = { 'Content-Type': 'text/plain' };
      if (state.failure.retryAfter !== undefined) {
        headers['Retry-After'] = String(state.failure.retryAfter);
      }
      res.writeHead(state.failure.status, headers);
      res.end(state.failure.body ?? 'stub failure');
      return;
    }

    const send = (payload) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (state.invalidJson) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('<!doctype html><html>not json</html>');
      return;
    }

    const path = url.pathname.replace(/^\/v2/, '');

    if (path === '/country') {
      const [meta, rows] = countryMetadataEnvelope();
      send([{ ...meta, total: meta.total + state.metaTotalOffset }, rows]);
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
          lastupdated: baseMeta.lastupdated,
        }),
      );
      return;
    }

    const indicatorMatch = /^\/indicator\/(.+)$/.exec(path);
    if (indicatorMatch) {
      const metricKey = metricKeyForCode(decodeURIComponent(indicatorMatch[1]));
      if (!metricKey) {
        send([{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }]);
        return;
      }
      send([
        { page: 1, pages: 1, per_page: 5, total: 1, sourceid: '2', lastupdated: isSnapshotMetric(metricKey) ? snapshot.indicators[metricKey].lastUpdated : TOTAL_GDP_LAST_UPDATED },
        [metadataRowFor(metricKey)],
      ]);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('stub: unknown endpoint');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v2`;

  return {
    baseUrl,
    state,
    requestCount: () => state.requests.length,
    reset() {
      state.requests.length = 0;
      state.failure = null;
      state.metaTotalOffset = 0;
      state.invalidJson = false;
    },
    /** Fail the next `times` requests with the given status (and Retry-After). */
    failNext({ status = 500, times = 1, retryAfter, body } = {}) {
      state.failure = { status, times, retryAfter, body };
    },
    /** Serve rows with a meta.total larger than the rows actually returned. */
    setMetaTotalOffset(offset) {
      state.metaTotalOffset = offset;
    },
    sendInvalidJson(next = true) {
      state.invalidJson = next;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export default { startStubWorldBank, useStubBaseUrl };