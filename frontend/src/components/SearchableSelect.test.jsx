import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushReact } from '../test-utils.js';
import { SearchableSelect } from './controls.jsx';

const YEARS = Array.from({ length: 66 }, (_, i) => ({
  value: String(1960 + i),
  label: String(1960 + i),
}));

function renderSelect(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  act(() => {
    root.render(
      <SearchableSelect id="year-test" label="Year" value="2024" options={YEARS} onChange={onChange} {...props} />,
    );
  });
  return { container, onChange, cleanup: () => act(() => root.unmount()) || container.remove() };
}

function openMenu(container) {
  const button = container.querySelector('#year-test');
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('SearchableSelect anchored popover', () => {
  let innerWidth = null;
  afterEach(() => {
    document.body.innerHTML = '';
    if (innerWidth !== null) {
      Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true });
      innerWidth = null;
    }
    vi.unstubAllEnvs();
  });

  it('opens one styled portal popover anchored with inline geometry, never a sheet', async () => {
    const { container, cleanup } = renderSelect({});
    await flushReact(act);
    openMenu(container);
    await flushReact(act);
    const popover = document.querySelector('.combo-popover-portal');
    expect(popover).toBeTruthy();
    expect(document.querySelector('.combo-popover-sheet')).toBeNull();
    expect(popover.style.top !== '' || popover.style.bottom !== '').toBe(true);
    expect(popover.style.left).not.toBe('');
    expect(popover.style.width).not.toBe('');
    // Long year list scrolls inside the popover with the filter pinned.
    expect(popover.querySelector('.combo-filter')).toBeTruthy();
    expect(popover.querySelectorAll('.combo-option').length).toBeGreaterThan(0);
    cleanup();
  });

  it('stays anchored and viewport-clamped on a 390px viewport', async () => {
    innerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const { container, cleanup } = renderSelect({});
    await flushReact(act);
    openMenu(container);
    await flushReact(act);
    const popover = document.querySelector('.combo-popover-portal');
    expect(popover).toBeTruthy();
    expect(document.querySelector('.combo-popover-sheet')).toBeNull();
    const width = Number.parseFloat(popover.style.width);
    const left = Number.parseFloat(popover.style.left);
    expect(width).toBeLessThanOrEqual(390 - 16);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + width).toBeLessThanOrEqual(390 - 8 + 1);
    cleanup();
  });

  it('marks the selected year, commits a different choice, closes on Escape with focus restored', async () => {
    const { container, onChange, cleanup } = renderSelect({ value: '2020' });
    await flushReact(act);
    openMenu(container);
    await flushReact(act);
    // Current selection marked and scrolled into view.
    const selected = document.querySelector('.combo-option-selected');
    expect(selected?.textContent).toContain('2020');
    const target = [...document.querySelectorAll('.combo-option')].find((el) => el.textContent === '2024');
    act(() => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('2024');
    expect(document.querySelector('.combo-popover-portal')).toBeNull();

    openMenu(container);
    await flushReact(act);
    expect(document.querySelector('.combo-popover-portal')).toBeTruthy();
    act(() => {
      document.querySelector('.combo-filter').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    await flushReact(act);
    expect(document.querySelector('.combo-popover-portal')).toBeNull();
    expect(document.activeElement?.id).toBe('year-test');
    cleanup();
  });

  it('click-outside closes without selecting', async () => {
    const { container, onChange, cleanup } = renderSelect({});
    await flushReact(act);
    openMenu(container);
    await flushReact(act);
    expect(document.querySelector('.combo-popover-portal')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flushReact(act);
    expect(document.querySelector('.combo-popover-portal')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    cleanup();
  });
});
