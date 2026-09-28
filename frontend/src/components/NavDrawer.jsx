/**
 * Analytical navigation drawer (post-release UX track).
 *
 * The nine analytical workspaces live here instead of crowding the header;
 * Home/Methodology/About stay directly visible. Navigation state is the
 * existing `view` string — selection calls the same `setFilter('view', …)`
 * and closes, so `?view=` deep links keep working with no router.
 *
 * A proper dialog interaction (not a form dropdown): overlay drawer +
 * scrim through the shared portal mount, initial focus inside, Escape and
 * scrim close with focus returned to the trigger, Tab reaches every
 * destination, active view announced via aria-current.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getPortalMount } from './popover.js';

export default function NavDrawer({
  open,
  destinations = [],
  active = null,
  triggerLabel = 'Explore analysis',
  returnFocusRef = null,
  onSelect,
  onClose,
}) {
  const panelRef = useRef(null);
  const itemRefs = useRef([]);
  const closeIntent = useRef(null);

  // Lock the page behind the drawer; restore overflow (only) on close so
  // the scroll position never jumps.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open ]);

  // Initial focus lands on the active destination (or the first one), so
  // keyboard and screen-reader users start inside the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      const activeIndex = Math.max(0, destinations.findIndex((d) => d.id === active));
      (itemRefs.current[activeIndex] ?? panelRef.current)?.focus?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [open, destinations, active]);

  function close(returnFocus) {
    closeIntent.current = returnFocus ? 'refocus' : 'none';
    onClose?.();
  }

  // Refocus the trigger after close (effect, not the event, so it also
  // covers scrim/Escape paths uniformly).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      if (closeIntent.current === 'refocus') returnFocusRef?.current?.focus?.();
      closeIntent.current = null;
    }
    wasOpen.current = open;
    return undefined;
  }, [open, returnFocusRef]);

  function focusItem(index) {
    const count = destinations.length;
    if (count === 0) return;
    const next = (index + count) % count;
    itemRefs.current[next]?.focus();
  }

  function handlePanelKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const current = itemRefs.current.findIndex((el) => el === document.activeElement);
      focusItem(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const current = itemRefs.current.findIndex((el) => el === document.activeElement);
      focusItem(current === -1 ? destinations.length - 1 : current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(destinations.length - 1);
    }
  }

  function choose(destination) {
    if (destination && destination.id !== active) onSelect?.(destination.id);
    close(true);
  }

  if (!open) return null;
  const portalNode = getPortalMount();
  if (!portalNode) return null;

  return createPortal(
    <div className="navdrawer-root">
      <div
        className="navdrawer-scrim"
        aria-hidden="true"
        onMouseDown={(event) => {
          event.preventDefault();
          close(true);
        }}
      />
      <aside
        ref={panelRef}
        className="navdrawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Analytical views"
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="navdrawer-head">
          <h2 id="navdrawer-title">Analytical views</h2>
          <button type="button" className="btn btn-ghost" aria-label="Close navigation" onClick={() => close(true)}>
            ×
          </button>
        </div>
        <p className="navdrawer-sub">Data workspaces. Informational pages stay in the header.</p>
        <ul className="navdrawer-list" aria-labelledby="navdrawer-title">
          {destinations.map((destination, index) => {
            const selected = destination.id === active;
            return (
              <li key={destination.id}>
                <button
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  className={selected ? 'navdrawer-item navdrawer-item-active' : 'navdrawer-item'}
                  onClick={() => choose(destination)}
                >
                  <span className="navdrawer-item-label">{destination.label}</span>
                  {destination.hint ? <span className="navdrawer-item-hint">{destination.hint}</span> : null}
                  {selected ? <span className="navdrawer-item-check" aria-hidden="true">✓</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="footnote">Current: {triggerLabel}</p>
      </aside>
    </div>,
    portalNode,
  );
}

/**
 * Closed-drawer trigger showing the analytical context (or a neutral label
 * on informational pages). Never a bare icon: the label always names where
 * the button leads.
 */
export function NavDrawerTrigger({ label, expanded, onClick, buttonRef, id = 'navdrawer-trigger' }) {
  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      className="tab navdrawer-trigger"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span aria-hidden="true">☰</span> {label}
    </button>
  );
}
