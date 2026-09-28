import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPartialDate, siteMetadata } from './site.js';

describe('site display metadata', () => {
  it('falls back neutrally with no configuration', () => {
    const meta = siteMetadata({});
    expect(meta.authorSpecified).toBe(false);
    expect(meta.authorName).toBe('');
    expect(meta.lastUpdatedText).toBeNull();
    expect(meta.dataText).toBeNull();
    expect(meta.sourceName).toBe('World Bank WDI');
  });

  it('passes author values through without inventing them', () => {
    const meta = siteMetadata({ VITE_SITE_AUTHOR_NAME: 'Ada Lovelace', VITE_SITE_AUTHOR_ROLE: 'Researcher' });
    expect(meta.authorSpecified).toBe(true);
    expect(meta.authorName).toBe('Ada Lovelace');
    expect(meta.authorRole).toBe('Researcher');
  });

  it('composes dates from parts without format-string editing', () => {
    expect(
      siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026', VITE_SITE_LAST_UPDATED_MONTH: '7', VITE_SITE_LAST_UPDATED_DAY: '4' }).lastUpdatedText,
    ).toBe('4 July 2026');
    expect(siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026', VITE_SITE_LAST_UPDATED_MONTH: '7' }).lastUpdatedText).toBe('July 2026');
    expect(siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026' }).lastUpdatedText).toBe('2026');
    expect(siteMetadata({ VITE_SITE_DATA_YEAR: '2025', VITE_SITE_DATA_MONTH: '12' }).dataText).toBe('December 2025');
  });

  it('degrades invalid dates to null, never nonsense', () => {
    expect(formatPartialDate({ year: null })).toBeNull();
    expect(formatPartialDate({ year: 1800 })).toBeNull();
    expect(siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026', VITE_SITE_LAST_UPDATED_MONTH: '13' }).lastUpdatedText).toBe('2026');
    expect(
      siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026', VITE_SITE_LAST_UPDATED_MONTH: '2', VITE_SITE_LAST_UPDATED_DAY: '30' }).lastUpdatedText,
    ).toBe('February 2026');
    expect(siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: 'soon' }).lastUpdatedText).toBeNull();
  });

  it('accepts English month names as well as numbers', () => {
    expect(siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026', VITE_SITE_LAST_UPDATED_MONTH: 'September' }).lastUpdatedText).toBe('September 2026');
    expect(siteMetadata({ VITE_SITE_DATA_YEAR: '2026', VITE_SITE_DATA_MONTH: 'september' }).dataText).toBe('September 2026');
    expect(
      siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026', VITE_SITE_LAST_UPDATED_MONTH: 'Sep', VITE_SITE_LAST_UPDATED_DAY: '28' }).lastUpdatedText,
    ).toBe('28 September 2026');
    expect(siteMetadata({ VITE_SITE_LAST_UPDATED_YEAR: '2026', VITE_SITE_LAST_UPDATED_MONTH: 'Notamonth' }).lastUpdatedText).toBe('2026');
  });

  it('exposes a validated contact email or nothing at all', () => {
    expect(siteMetadata({}).contactEmail).toBe('');
    expect(siteMetadata({}).contactSpecified).toBe(false);
    const good = siteMetadata({ VITE_SITE_CONTACT_EMAIL: 'hello@example.org' });
    expect(good.contactEmail).toBe('hello@example.org');
    expect(good.contactSpecified).toBe(true);
    expect(siteMetadata({ VITE_SITE_CONTACT_EMAIL: 'not-an-email' }).contactSpecified).toBe(false);
    expect(siteMetadata({ VITE_SITE_CONTACT_EMAIL: 'a@b' }).contactSpecified).toBe(false);
  });

  it('documents every display key in .env.example with no secrets', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const example = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
    for (const key of [
      'VITE_SITE_AUTHOR_NAME',
      'VITE_SITE_AUTHOR_ROLE',
      'VITE_SITE_LAST_UPDATED_YEAR',
      'VITE_SITE_LAST_UPDATED_MONTH',
      'VITE_SITE_LAST_UPDATED_DAY',
      'VITE_SITE_DATA_YEAR',
      'VITE_SITE_DATA_MONTH',
      'VITE_SITE_SOURCE_NAME',
      'VITE_SITE_CONTACT_EMAIL',
    ]) {
      expect(example.includes(key), `.env.example documents ${key}`).toBe(true);
    }
  });
});
