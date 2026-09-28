import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

describe('responsive architecture pins', () => {
  it('sticky header layers below popovers below the drawer', () => {
    const header = block('.app-header');
    expect(header).toContain('position: sticky');
    expect(header).toContain('top: 0');
    expect(header).toMatch(/z-index:\s*100/);
    expect(block('.combo-popover-portal')).toMatch(/z-index:\s*150/);
    expect(block('.navdrawer-scrim')).toMatch(/z-index:\s*200/);
    expect(block('.navdrawer-panel')).toMatch(/z-index:\s*201/);
  });

  it('every top-level view gets breathing room below the sticky header', () => {
    expect(block('#main')).toMatch(/padding-top:\s*1rem/);
  });

  it('drawer is a bounded side panel, never full-screen', () => {
    expect(block('.navdrawer-panel')).toContain('min(22rem');
    expect(block('.navdrawer-panel')).toContain('100dvh');
    expect(css).toContain('min(76vw, 20rem)');
    expect(css).not.toMatch(/\.navdrawer-panel[^}]*width:\s*100vw/);
  });

  it('drawer floats with daylight margins and rounded corners', () => {
    expect(block('.navdrawer-panel')).toContain('top: 1rem');
    expect(block('.navdrawer-panel')).toContain('border-radius: 16px');
    expect(css).toContain('top: 0.75rem');
  });

  it('mobile header stacks brand above navigation', () => {
    expect(css).toContain('.header-row');
    expect(css).toContain('flex-direction: column');
  });

  it('home family links wrap instead of clipping', () => {
    expect(block('.home-card-link')).toContain('white-space: normal');
  });

  it('anchored sections clear the sticky header', () => {
    expect(block('.section')).toContain('scroll-margin-top');
  });

  it('methodology breadcrumbs wrap without horizontal overflow', () => {
    const crumbs = block('.crumbs');
    expect(crumbs).toContain('display: flex');
    expect(crumbs).toContain('flex-wrap: wrap');
    expect(crumbs).not.toContain('overflow-x');
  });

  it('breadcrumb parents are quiet links, current level is emphasized', () => {
    expect(block('.crumb-link')).toContain('text-decoration: none');
    expect(block('.crumb-current')).toContain('font-weight: 700');
  });

  it('brand identity text stays inside the header on narrow screens', () => {
    expect(block('.brand-row > div')).toContain('min-width: 0');
  });
});
