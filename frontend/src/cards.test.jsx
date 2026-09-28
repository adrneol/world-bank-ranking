import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flushReact, stubFetch } from './test-utils.js';
import Home from './sections/Home.jsx';
import Methodology from './sections/Methodology.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');

const INDICATORS = {
  subjects: [{ key: 'prices', label: 'Prices' }],
  production: [
    {
      key: 'inflation_cpi',
      subject: 'prices',
      label: 'CPI inflation',
      shortLabel: 'CPI inflation',
      unit: 'annual %',
      indicatorCode: 'FP.CPI.TOTL.ZG',
      rankingDirection: 'ASC',
      pricesBases: [
        {
          id: 'cpi_inflation_annual',
          label: 'Annual CPI inflation (%)',
          description: 'Annual rate.',
          formula: 'A(i,t)',
          unit: 'annual %',
          rankable: true,
          rankDirection: 'ASC',
          rankWording: 'Ranked lowest first',
          requiresSequence: false,
        },
      ],
    },
  ],
  methodology: {},
};

function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('family card actions', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('Home actions are short, consistent, and stay inside wrapping buttons', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, cleanup } = render(
      <Home sourceName="World Bank WDI" onOpenView={() => {}} onOpenSubject={() => {}} />,
    );
    await flushReact(act);
    const actions = [...container.querySelectorAll('.home-card-link')];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      // No family-name repetition, no truncation-prone nowrap ghost links.
      expect(action.textContent).toMatch(/^(Open in Movement|Explore methodology) →$/);
      expect(action.tagName).toBe('BUTTON');
    }
    const cards = [...container.querySelectorAll('.family-card')];
    expect(cards.length).toBe(actions.length);
    cleanup();
  });

  it('Methodology family cards use the same short action vocabulary', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, cleanup } = render(<Methodology />);
    await flushReact(act);
    const actions = [...container.querySelectorAll('.family-card .home-card-link')];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.textContent).toBe('Explore →');
    }
    cleanup();
  });

  it('formula blocks are contained, never card-overflowing', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, cleanup } = render(<Methodology />);
    await flushReact(act);
    // Browse family → metric → basis cards to render the formula block.
    const clickCardButton = (text) => {
      const button = [...container.querySelectorAll('.family-card button')].find((el) => el.textContent === text);
      if (!button) throw new Error(`card button not found: ${text}`);
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    };
    clickCardButton('Explore →');
    await flushReact(act);
    clickCardButton('Explore →');
    await flushReact(act);
    clickCardButton('Read methodology →');
    await flushReact(act);
    const formula = container.querySelector('.formula-scroll');
    expect(formula).toBeTruthy();
    expect(formula.textContent).toContain('A(i,t)');
    expect(css).toContain('.formula-scroll');
    expect(css).toMatch(/\.formula-scroll[^}]*overflow-x:\s*auto/);
    cleanup();
  });
});

describe('header/drawer visual pins', () => {
  it('hides the mobile nav scrollbar without disabling scrolling', () => {
    expect(css).toMatch(/\.mainnav\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.mainnav::-webkit-scrollbar\s*\{\s*display:\s*none/);
    expect(css).toMatch(/scrollbar-width:\s*none/);
  });

  it('bounds the mobile drawer below full-screen', () => {
    expect(css).toContain('min(76vw, 20rem)');
    expect(css).not.toMatch(/\.navdrawer-panel[^}]*width:\s*100vw/);
  });

  it('keeps family cards in normal flow with bottom-pinned actions', () => {
    expect(css).toMatch(/\.family-card\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.family-card \.card-action\s*\{[^}]*margin-top:\s*auto/);
  });
});
