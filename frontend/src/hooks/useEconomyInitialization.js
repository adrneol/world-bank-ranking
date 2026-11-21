import { useEffect, useRef, useState } from 'react';
import { eligibleLocationCountry, resolveEconomyLocation } from '../services/economyLocation.js';

const normalize = value => String(value ?? '').trim().toUpperCase();

/** Shared, bounded initialization. Route/metric/theme changes never start a new lookup. */
export function useEconomyInitialization({ countries, registryState, bootstrapReady, country, explicit }) {
  const [lookup, setLookup] = useState({ phase: 'idle', candidate: null, attempts: 0 });
  const manager = useRef({ subscribed: false, active: false, attempts: 0, request: 0, controller: null, timer: null });
  const selected = eligibleLocationCountry({ iso3: normalize(country) }, countries);
  const selectedIso3 = selected?.iso3 ?? null;
  const detected = registryState === 'ready' ? eligibleLocationCountry(lookup.candidate, countries) : null;
  const pendingUrl = explicit && normalize(country) !== '' && registryState === 'loading';
  const recoveryReady = registryState === 'ready' && bootstrapReady;

  useEffect(() => {
    const current = manager.current;
    current.subscribed = true;
    return () => {
      current.subscribed = false;
      // StrictMode's immediate effect replay retains the same single flight.
      queueMicrotask(() => {
        if (current.subscribed) return;
        current.request += 1;
        clearTimeout(current.timer);
        current.controller?.abort();
      });
    };
  }, []);

  useEffect(() => {
    const current = manager.current;
    if (selectedIso3) {
      current.request += 1;
      clearTimeout(current.timer);
      current.controller?.abort();
      current.active = false;
      return;
    }
    if (pendingUrl || current.active || lookup.candidate || current.attempts >= 2) return;
    if (current.attempts > 0 && !recoveryReady) return;
    current.active = true;
    current.attempts += 1;
    const attempt = current.attempts;
    const request = ++current.request;
    const controller = new AbortController();
    current.controller = controller;
    setLookup({ phase: 'resolving', candidate: null, attempts: attempt });
    const run = async () => {
      let candidate = null;
      try { candidate = await resolveEconomyLocation(controller.signal); } catch { /* Bounded failure leaves manual selection available. */ }
      if (!current.subscribed || controller.signal.aborted || current.request !== request) return;
      current.active = false;
      setLookup({ phase: 'complete', candidate, attempts: attempt });
    };
    if (attempt === 1) run();
    else current.timer = setTimeout(run, 500);
  }, [selectedIso3, pendingUrl, recoveryReady, lookup]);

  let status;
  if (selected) status = explicit ? 'explicit' : 'resolved';
  else if (detected) status = 'resolved';
  else if (registryState === 'loading' && (pendingUrl || lookup.candidate || lookup.phase === 'complete')) status = 'waiting-for-registry';
  else if (lookup.phase !== 'complete' || (!lookup.candidate && lookup.attempts < 2 && recoveryReady)) status = 'resolving';
  else status = 'unavailable';
  return { status, country: detected?.iso3 ?? null };
}
