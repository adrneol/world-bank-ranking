// Shared jsdom shims for frontend tests (no production effect).

// matchMedia (used by chart/dropdown/media hooks).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// visualViewport (used defensively by the popover engine).
if (typeof window !== 'undefined' && !window.visualViewport) {
  window.visualViewport = null;
}

// scrollIntoView (used by dropdown keyboard navigation).
if (typeof window !== 'undefined' && window.HTMLElement && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// React 19 act() environment flag.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
