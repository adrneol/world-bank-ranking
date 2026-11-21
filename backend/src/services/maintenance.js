import { getDatasetState, markIntegrityVerified, parseStoredIntegrityChecks } from '../db/repository.js';
import { runExpensiveIntegrityChecks } from './integrity.js';
import { expensiveIntegrityKey, getCachedExpensiveIntegrity, storedReportMatchesCurrentVintage } from './statusCache.js';

/** Controlled maintenance only, never an ordinary GET. Persist exact generation proof. */
export async function persistVerifiedGeneration(db) {
  const tx = await db.transaction('read');
  let state, proof;
  try {
    state = await getDatasetState(tx);
    if (!state) return false;
    const stored = parseStoredIntegrityChecks(state);
    if (state.integrityVerifiedContentVersion === state.contentVersion && stored && stored.every(check => check.status === 'pass') &&
        storedReportMatchesCurrentVintage(stored, state.maxWbLastUpdated)) return false;
    proof = await getCachedExpensiveIntegrity(expensiveIntegrityKey(state.contentVersion, state.maxWbLastUpdated), async () => {
      const checks = await runExpensiveIntegrityChecks(tx);
      return { passed: checks.every(check => check.status === 'pass'), checks };
    }, db);
  } finally { tx.close(); }
  return proof.report.passed ? markIntegrityVerified(db, state.contentVersion, proof.report.checks) : false;
}

/** Server-owned cadence, independent of client query strings; one flight at a time. */
export function startMaintenance(check, { intervalMs = 60000, onError = () => {}, schedule = setInterval } = {}) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await check(); } catch (error) { onError(error); }
    finally { running = false; }
  };
  const timer = schedule(tick, intervalMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
