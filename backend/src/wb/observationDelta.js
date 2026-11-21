/** Exact delta over an already validated complete indicator/range payload. */
export function observationDelta(stored, staged) {
  const remaining = new Map(stored.map(row => [`${row.countryId}\n${row.year}`, row]));
  const upserts = [];
  let unchanged = 0;
  for (const row of staged) {
    const key = `${row.countryId}\n${row.year}`, previous = remaining.get(key);
    if (!previous || previous.value !== row.value ||
        (previous.valueRaw ?? null) !== (row.valueRaw ?? null) ||
        (previous.wbLastUpdated ?? null) !== (row.wbLastUpdated ?? null)) upserts.push(row);
    else unchanged++;
    remaining.delete(key);
  }
  return { upserts, removals: [...remaining.values()], unchanged };
}
