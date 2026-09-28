import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NavDrawer, { NavDrawerTrigger } from './NavDrawer.jsx';

const DESTINATIONS = [
  { id: 'overview', label: 'Overview', hint: 'Focus-country cards' },
  { id: 'movement', label: 'Movement', hint: 'Rank movement' },
  { id: 'status', label: 'Status', hint: 'Refresh' },
];

function renderDrawer(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const merged = {
    open: true,
    destinations: DESTINATIONS,
    active: 'movement',
    triggerLabel: 'Movement',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...props,
  };
  act(() => {
    root.render(<NavDrawer {...merged} />);
  });
  return { container, root, props: merged, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('NavDrawer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders closed as nothing', () => {
    const { container, cleanup } = renderDrawer({ open: false });
    expect(container.textContent).toBe('');
    expect(document.querySelector('.navdrawer-panel')).toBeNull();
    cleanup();
  });

  it('lists every destination with the active view announced', async () => {
    const { cleanup } = renderDrawer({});
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const items = [...document.querySelectorAll('.navdrawer-item')];
    expect(items.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Overview'), expect.stringContaining('Movement'), expect.stringContaining('Status')]),
    );
    expect(items).toHaveLength(3);
    const active = document.querySelector('.navdrawer-item-active');
    expect(active.textContent).toContain('Movement');
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement?.textContent).toContain('Movement');
    cleanup();
  });

  it('selecting a destination navigates and closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { cleanup } = renderDrawer({ onSelect, onClose });
    const overview = [...document.querySelectorAll('.navdrawer-item')].find((el) => el.textContent.includes('Overview'));
    act(() => {
      overview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('overview');
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });

  it('Escape closes and returns focus to the trigger', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    const triggerRef = { current: null };
    function Wrapper() {
      const [isOpen, setIsOpen] = useState(true);
      return (
        <>
          <button
            ref={(el) => {
              triggerRef.current = el;
            }}
          >
            trigger
          </button>
          <NavDrawer
            open={isOpen}
            destinations={DESTINATIONS}
            active="movement"
            triggerLabel="Movement"
            returnFocusRef={triggerRef}
            onSelect={onSelect}
            onClose={() => setIsOpen(false)}
          />
        </>
      );
    }
    act(() => {
      root.render(<Wrapper />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      document.querySelector('.navdrawer-panel').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(document.querySelector('.navdrawer-panel')).toBeNull();
    expect(document.activeElement?.textContent).toBe('trigger');
    act(() => root.unmount());
    container.remove();
  });

  it('trigger shows the analytical context label', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<NavDrawerTrigger label="Movement" expanded={false} onClick={() => {}} />);
    });
    const button = container.querySelector('#navdrawer-trigger');
    expect(button.textContent).toContain('Movement');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    act(() => root.unmount());
    container.remove();
  });
});
