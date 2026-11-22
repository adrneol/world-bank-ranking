/** Acquisition and validation use UTC, independent of server locale/time zone. */
export const calendarYear = (now = new Date()) => now.getUTCFullYear();
export function parseYearLimit(value) {
  if (value == null || String(value).trim() === '' || String(value).trim().toLowerCase() === 'auto') return null;
  if (!/^\d{4}$/.test(String(value).trim())) throw new Error('INGEST_END_YEAR must be auto or a four-digit annual limit.');
  const year = Number(value);
  if (year < 1000 || year > 9999) throw new Error('INGEST_END_YEAR must be within 1000–9999.');
  return year;
}
