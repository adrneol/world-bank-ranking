/* 8C: instrumented full local refresh — per-stage timing. Removed after. */
import fs from 'node:fs';
const SCRATCH = 'C:/Users/n0ne/AppData/Local/Temp/opencode/scale-8c.db';
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(SCRATCH + s); } catch {} }
fs.copyFileSync('data/worldbank.db', SCRATCH);

const { createClient } = await import('@libsql/client');
const { initDatabase } = await import('./src/db/index.js');
const db = createClient({ url: `file:${SCRATCH}` });
await initDatabase(db, { localFile: true });

// Time WB HTTP via fetch wrapper (records URL + duration).
const stages = [];
let current = null;
const origFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = String(args[0]);
  const t0 = Date.now();
  try {
    return await origFetch(...args);
  } finally {
    if (/api\.worldbank\.org/.test(url)) {
      stages.push({ kind: 'wb', url: url.replace(/.*\/v2\//, '/v2/').slice(0, 90), ms: Date.now() - t0 });
    }
  }
};

// Time DB statements by shape family.
const dbStat = {};
const origExec = db.execute.bind(db);
db.execute = (...args) => {
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql ?? '';
  const t0 = Date.now();
  return origExec(...args).then((r) => {
    const fam = /^\s*SELECT/i.test(sql)
      ? (/observations/i.test(sql) ? 'sel-obs' : 'sel-other')
      : (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? 'write' : 'other');
    dbStat[fam] = dbStat[fam] ?? { n: 0, ms: 0 };
    dbStat[fam].n += 1;
    dbStat[fam].ms += Date.now() - t0;
    return r;
  });
};
const origTx = db.transaction.bind(db);
db.transaction = async (...a) => {
  const tx = await origTx(...a);
  const oE = tx.execute.bind(tx);
  tx.execute = (...b) => {
    const sql = typeof b[0] === 'string' ? b[0] : b[0]?.sql ?? '';
    const t0 = Date.now();
    return oE(...b).then((r) => {
      const fam = /^\s*SELECT/i.test(sql)
        ? (/observations/i.test(sql) ? 'sel-obs' : 'sel-other')
        : (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? 'write' : 'other');
      dbStat[fam] = dbStat[fam] ?? { n: 0, ms: 0 };
      dbStat[fam].n += 1;
      dbStat[fam].ms += Date.now() - t0;
      return r;
    });
  };
  if (tx.batch) {
    const oB = tx.batch.bind(tx);
    tx.batch = (...b) => {
      const t0 = Date.now();
      return oB(...b).then((r) => {
        dbStat.batch = dbStat.batch ?? { n: 0, ms: 0 };
        dbStat.batch.n += (b[0] ?? []).length;
        dbStat.batch.ms += Date.now() - t0;
        return r;
      });
    };
  }
  return tx;
};

let peak = { rss: 0, heapUsed: 0 };
const timer = setInterval(() => {
  const m = process.memoryUsage();
  if (m.rss > peak.rss) peak.rss = m.rss;
  if (m.heapUsed > peak.heapUsed) peak.heapUsed = m.heapUsed;
}, 250);

const { refreshData } = await import('./src/wb/ingest.js');
const marks = [];
const t0 = Date.now();
const summary = await refreshData({
  db,
  trigger: 'scale-test',
  onProgress: (p) => marks.push({ t: Date.now() - t0, stage: p.stage }),
});
const ms = Date.now() - t0;
clearInterval(timer);
globalThis.fetch = origFetch;

// Per-indicator windows from progress marks.
const indMarks = marks.filter((m) => m.stage.startsWith('indicator:'));
const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
console.log(JSON.stringify({
  status: summary.status, retrieved: summary.rowsRetrieved, upserted: summary.rowsUpserted,
  skipped: summary.rowsSkippedUnchanged, requests: summary.requests, pages: summary.pagesFetched,
  totalMs: ms,
  wbCalls: stages.length,
  wbTotalMs: stages.reduce((n, s) => n + s.ms, 0),
  wbMax: Math.max(...stages.map((s) => s.ms)),
  wbSlowest: [...stages].sort((a, b) => b.ms - a.ms).slice(0, 8),
  dbStat,
  peak: { rss: mb(peak.rss), heap: mb(peak.heapUsed) },
  indicatorWindows: indMarks.map((m, i) => ({
    stage: m.stage,
    ms: i + 1 < indMarks.length ? indMarks[i + 1].t - m.t : ms - m.t,
  })),
}, null, 1));
db.close();
process.exit(0);
