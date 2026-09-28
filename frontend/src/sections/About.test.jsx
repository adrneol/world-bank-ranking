import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { siteMetadata } from '../config/site.js';
import About from './About.jsx';

function renderAbout(site) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenView = vi.fn();
  act(() => {
    root.render(<About site={site} onOpenView={onOpenView} />);
  });
  return { container, onOpenView, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('About page', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllEnvs();
  });

  it('renders fully without backend data, with neutral fallbacks when unconfigured', () => {
    const { container, cleanup } = renderAbout(siteMetadata({}));
    expect(container.textContent).toContain('Why this exists');
    expect(container.textContent).toContain('Author details not specified');
    expect(container.textContent).toContain('never manually entered');
    expect(container.textContent).toContain('World Bank WDI');
    cleanup();
  });

  it('shows configured author and date metadata', () => {
    const site = siteMetadata({
      VITE_SITE_AUTHOR_NAME: 'Ada Lovelace',
      VITE_SITE_AUTHOR_ROLE: 'Independent researcher',
      VITE_SITE_LAST_UPDATED_YEAR: '2026',
      VITE_SITE_LAST_UPDATED_MONTH: '7',
      VITE_SITE_DATA_YEAR: '2025',
      VITE_SITE_DATA_MONTH: '12',
    });
    const { container, cleanup } = renderAbout(site);
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('July 2026');
    expect(container.textContent).toContain('December 2025');
    cleanup();
  });

  it('routes to methodology and status without inventing content', () => {
    const { container, onOpenView, cleanup } = renderAbout(siteMetadata({}));
    const buttons = [...container.querySelectorAll('button')];
    buttons.find((b) => b.textContent.includes('How calculations work')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpenView).toHaveBeenCalledWith('methodology');
    expect(container.textContent).not.toMatch(/Ph\.?D|professor|award|university/i);
    cleanup();
  });

  it('shows the Contact section with a mailto action when configured', () => {
    const site = siteMetadata({ VITE_SITE_CONTACT_EMAIL: 'hello@example.org' });
    const { container, cleanup } = renderAbout(site);
    expect(container.textContent).toContain('Contact');
    expect(container.textContent).toContain('questions, feedback, or issues');
    const mailto = container.querySelector('a[href^="mailto:"]');
    expect(mailto).toBeTruthy();
    expect(mailto.getAttribute('href')).toBe('mailto:hello@example.org');
    expect(mailto.textContent).toContain('hello@example.org');
    cleanup();
  });

  it('shows a neutral Contact fallback when no email is configured', () => {
    const { container, cleanup } = renderAbout(siteMetadata({}));
    expect(container.textContent).toContain('Contact');
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).toContain('Contact details have not been published');
    cleanup();
  });
});
