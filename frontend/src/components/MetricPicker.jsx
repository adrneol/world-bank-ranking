/**
 * Metric picker for subject-grouped selection (Phase 6).
 *
 * Never a flat 20-item dropdown: options group by backend subject, built
 * from the hydrated registry (backend order, backend labels). Capability
 * metadata stays out of the option list itself — Compare filters operations
 * separately — but an optional operations map can annotate each option with
 * its valid analyses.
 */

import { SUBJECTS, metricLabel } from '../config/metrics.js';
import { SearchableSelect } from './controls.jsx';

export default function MetricPicker({ id, label = 'Metric', value, onChange, hint = null, operationsByMetric = null }) {
  // No useMemo here by design: the option list must always reflect the live
  // registry. A memoized list went stale after hydrateRegistry() swapped
  // SUBJECTS (first-load missing-metrics bug); twenty items recompute
  // trivially every render, and hydration propagates through App's
  // registryVersion state re-render.
  const options = Object.values(SUBJECTS).map((subject) => ({
    group: subject.label,
    items: subject.metricKeys.map((key) => {
      const ops = operationsByMetric?.[key];
      return {
        value: key,
        label: metricLabel(key),
        hint: ops && ops.length > 0 ? ops.map((o) => o.label).join(' · ') : undefined,
      };
    }),
  }));

  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder="Select a metric…"
      hint={hint}
    />
  );
}
