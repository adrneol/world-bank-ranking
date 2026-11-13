import { useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const action = dark ? 'Switch to light theme' : 'Switch to dark theme';

  function toggle() {
    const theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.add('theme-transition');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101828' : '#101b24');
    try { localStorage.setItem('wdi-theme', theme); } catch { /* Storage may be unavailable. */ }
    setDark(!dark);
  }

  return <button type="button" className="theme-toggle" aria-label={action} title={action} onClick={toggle}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></> :
        <path d="M20.8 15.2A9.2 9.2 0 0 1 8.8 3.2a9 9 0 1 0 12 12Z" />}
    </svg>
  </button>;
}
