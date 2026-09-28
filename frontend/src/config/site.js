/**
 * Public site display metadata.
 *
 * DISPLAY ONLY: author/update labels shown on informational pages. These
 * values must NEVER drive analytical behavior — WDI vintage, latest year,
 * indicator availability, observation dates and dataset freshness always
 * come from the backend/database. All variables are optional with neutral
 * fallbacks so local development works with no configuration.
 *
 * Parts are kept separate (year/month/day) so maintenance never involves
 * editing date-format strings; display text is composed here in one place.
 */

const MONTH_NAMES = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

function rawText(env, key) {
  const value = env?.[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function rawInt(env, key) {
  const text = rawText(env, key);
  if (text === '') return null;
  const n = Number.parseInt(text, 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * Month number from a numeric value ("07", "7") or an English month name
 * ("September", "september", "Sep" accepted case-insensitively), so real
 * deployment files are forgiving. Anything else yields null (month omitted).
 */
function parseMonth(env, key) {
  const text = rawText(env, key);
  if (text === '') return null;
  const numeric = Number.parseInt(text, 10);
  if (Number.isInteger(numeric)) return validMonth(numeric);
  const lowered = text.toLowerCase();
  const index = MONTH_NAMES.findIndex(
    (name) => name.toLowerCase() === lowered || name.toLowerCase().slice(0, 3) === lowered.slice(0, 3),
  );
  return index >= 0 ? index + 1 : null;
}

/** Minimal email shape check for display: presentable, never verified. */
function validEmail(value) {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : '';
}

function validMonth(month) {
  return month !== null && month >= 1 && month <= 12 ? month : null;
}

function validDay(year, month, day) {
  if (day === null || day < 1 || day > 31) return null;
  if (year !== null && month !== null) {
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth) return null;
  }
  return day;
}

/** "July 2026", "4 July 2026", "2026", or null when the year is unknown. */
export function formatPartialDate({ year, month = null, day = null }) {
  if (year === null || year === undefined || year < 1900 || year > 2100) return null;
  if (month === null) return String(year);
  const dayText = day !== null ? `${day} ` : '';
  return `${dayText}${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Resolve display metadata. Accepts an explicit env mapping (tests) or
 * defaults to the Vite environment.
 */
export function siteMetadata(env = null) {
  const source = env ?? import.meta.env ?? {};
  const authorName = rawText(source, 'VITE_SITE_AUTHOR_NAME');
  const authorRole = rawText(source, 'VITE_SITE_AUTHOR_ROLE');
  const updatedYear = rawInt(source, 'VITE_SITE_LAST_UPDATED_YEAR');
  const updatedMonth = parseMonth(source, 'VITE_SITE_LAST_UPDATED_MONTH');
  const updatedDay = validDay(updatedYear, updatedMonth, rawInt(source, 'VITE_SITE_LAST_UPDATED_DAY'));
  const dataYear = rawInt(source, 'VITE_SITE_DATA_YEAR');
  const dataMonth = parseMonth(source, 'VITE_SITE_DATA_MONTH');
  const contactEmail = validEmail(rawText(source, 'VITE_SITE_CONTACT_EMAIL'));
  return {
    authorName,
    authorRole,
    authorSpecified: authorName !== '' || authorRole !== '',
    lastUpdatedText: formatPartialDate({ year: updatedYear, month: updatedMonth, day: updatedDay }),
    dataText: formatPartialDate({ year: dataYear, month: dataMonth }),
    sourceName: rawText(source, 'VITE_SITE_SOURCE_NAME') || 'World Bank WDI',
    contactEmail,
    contactSpecified: contactEmail !== '',
  };
}

export default siteMetadata;
