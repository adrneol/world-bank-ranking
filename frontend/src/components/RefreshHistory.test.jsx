import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import RefreshHistory from './RefreshHistory.jsx';

let cleanup;
afterEach(() => { cleanup?.(); vi.restoreAllMocks(); delete HTMLDialogElement.prototype.showModal; });
it('keeps raw failures outside the ledger and preserves every recorded field in a dialog', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  const text = 'remittances_received timeout https://api.worldbank.org/v2/example?source=2\n'.repeat(30);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  act(() => root.render(<RefreshHistory runs={[{ id: 41, status: 'partial', trigger: 'ttl', error_message: text,
    started_at: '2026-08-01T00:00:00Z', completed_at: '2026-08-01T00:01:00Z', rows_upserted: 0,
    summary_counts: { total: 20, updated: 19, unchanged: 0, failed: 1 } }]} />));
  const row = container.querySelector('tbody tr');
  expect(row.textContent).toContain('1 indicator failed');
  expect(row.textContent).toContain('Not published');
  // Closed dialog content is outside the rendered ledger flow.
  expect(container.querySelector('dialog').hasAttribute('open')).toBe(false);
  const button = row.querySelector('button');
  act(() => button.click());
  const dialog = container.querySelector('dialog[open]');
  expect(dialog.querySelector('pre').textContent).toBe(text);
  expect(dialog.textContent).toContain('"rows_upserted": 0');
  expect(container.querySelector('[data-column-kind="timestamp"]')).not.toBeNull();
});
