/**
 * Accessible tab navigation (WAI-ARIA tab pattern).
 *
 * Presentation only: switches which already-complete section is visible.
 * Tabs are buttons with roving tabindex; Left/Right/Home/End move between
 * them. Panels are lazy-mounted by the caller.
 */

import { useRef } from 'react';

export default function Tabs({ views, active, onChange }) {
  const tabRefs = useRef([]);

  function focusTab(index) {
    const count = views.length;
    const next = (index + count) % count;
    tabRefs.current[next]?.focus();
    onChange(views[next].id);
  }

  function handleKeyDown(event, index) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(views.length - 1);
    }
  }

  return (
    <div className="tabs" role="tablist" aria-label="Analytical views">
      {views.map((view, index) => {
        const selected = view.id === active;
        return (
          <button
            key={view.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${view.id}`}
            aria-selected={selected}
            aria-controls={`panel-${view.id}`}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'tab tab-active' : 'tab'}
            onClick={() => onChange(view.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}

/** Secondary tab row for focused subviews (Rank and YoY workspaces). */
export function SubTabs({ options, active, onChange, label }) {
  return (
    <div className="subtabs" role="tablist" aria-label={label}>
      {options.map((option) => {
        const selected = option.id === active;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'subtab subtab-active' : 'subtab'}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
