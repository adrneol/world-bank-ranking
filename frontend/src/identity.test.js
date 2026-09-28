/**
 * PRODUCT IDENTITY TESTS (Phase 3, Part A).
 *
 * The application is a generic World Bank WDI analysis tool, not an
 * India-only GDP ranking site. These tests pin the public identity:
 * document title, meta/OG/Twitter descriptions and the PWA manifest must
 * be generic, accurate and country-neutral, while preserving the
 * raw-observations-vs-derived-results distinction.
 */
import { describe, expect, it } from 'vitest';

import indexHtml from '../index.html?raw';
import manifestRaw from '../public/site.webmanifest?raw';

function doc() {
  return new DOMParser().parseFromString(indexHtml, 'text/html');
}

function metaContent(d, selector) {
  return d.querySelector(selector)?.getAttribute('content') ?? null;
}

describe('public product identity', () => {
  it('document title is generic, not India-GDP-specific', () => {
    const title = doc().querySelector('title')?.textContent ?? '';
    expect(title).toContain('World Bank WDI');
    expect(title).not.toMatch(/India/i);
  });

  it('meta description is generic and keeps the raw-vs-derived distinction', () => {
    const description = metaContent(doc(), 'meta[name="description"]') ?? '';
    expect(description).not.toMatch(/India/i);
    expect(description).toMatch(/World Bank/i);
    expect(description).toMatch(/ranking|comparison|coverage|movement/i);
  });

  it('Open Graph title and description are generic', () => {
    const d = doc();
    const ogTitle = metaContent(d, 'meta[property="og:title"]') ?? '';
    const ogDescription = metaContent(d, 'meta[property="og:description"]') ?? '';
    expect(ogTitle).toContain('World Bank WDI');
    expect(ogTitle).not.toMatch(/India/i);
    expect(ogDescription).not.toMatch(/India/i);
    // Must not claim the World Bank publishes the rankings.
    expect(ogDescription).toMatch(/raw observations|derived|calculated by this application/i);
  });

  it('no product-level India-GDP-ranking metadata remains', () => {
    for (const text of ['India GDP ranking', 'Independently calculated India']) {
      expect(indexHtml).not.toContain(text);
    }
  });
});

describe('PWA identity', () => {
  it('manifest name, short_name and description are generic', () => {
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.name).toContain('World Bank WDI');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(20);
    for (const field of [manifest.name, manifest.short_name, manifest.description]) {
      expect(String(field)).not.toMatch(/India/i);
    }
    expect(String(manifest.description)).toMatch(/World Bank|ranking|comparison|coverage/i);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });
});
