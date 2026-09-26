/**
 * Metric picker for subject-grouped selection (Phase 6).
 *
 * Never a flat 20-item dropdown: options group by backend subject, built
 * from the hydrated registry (backend order, backend labels). Capability
 * metadata stays out of the option list itself — Compare filters operations
 * separately — but an optional operations map can annotate each option with
 * its valid analyses.
 */

import { useMemo } from 'react';
import { SUBJECTS, activeRegistryVersion, metricLabel } from '../config/metrics.js';
import { SearchableSelect } from './controls.jsx';

export default function MetricPicker({ id, label = 'Metric', value, onChange, hint = null, operationsByMetric = null, subject = null }) {
  // Family-scoped when `subject` names an analysis subject: only that
  // subject's metrics are offered (data-driven via the hydrated registry).
  // Memoized on the registry generation so hydration swaps propagate on the
  // next App re-render without rebuilding the list on every render.
  const version = activeRegistryVersion();
  const options = useMemo(() => {
    const subjects = subject && SUBJECTS[subject] ? [SUBJECTS[subject]] : Object.values(SUBJECTS);
    const built = [];
    for (const s of subjects) {
      const items = [];
      for (const key of s.metricKeys) {
        const ops = operationsByMetric?.[key];
        items.push({
          value: key,
          label: metricLabel(key),
          hint: ops && ops.length > 0 ? ops.map((o) => o.label).join(' · ') : undefined,
        });
      }
      built.push({ group: s.label, items });
    }
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, version, operationsByMetric]);

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
