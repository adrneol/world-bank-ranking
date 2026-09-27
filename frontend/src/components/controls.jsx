/**
 * Custom form controls (Phase 6 design system + Phase 3 popover repair).
 *
 * SearchableSelect is the single replacement for browser-native <select>
 * wherever lists are long or grouped: an accessible combobox built on
 * button + popover + listbox (no new dependencies). Full keyboard contract:
 * type to filter, ArrowUp/Down/Home/End to move, Enter to select, Escape to
 * close, Tab to leave. Disabled options carry their reason so an unavailable
 * action is explained, never silently offered.
 *
 * Popover architecture (Phase 3, R-06/R-09/R-10) — one shared system for
 * every dropdown (years, countries, metrics, bases, groups, relation/sort):
 * the popover renders through a portal (never clipped by card/table
 * overflow ancestors), positions viewport-aware (down when space allows,
 * up near the bottom edge, constrained otherwise — never hard-coded
 * top:100%), and degrades to a visual-viewport-safe bottom sheet only for
 * LONG lists on mobile. Short selectors stay compact anchored popovers.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Field } from './ui.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import {
  computePopoverPlacement,
  estimatePopoverHeight,
  shouldUseSheet,
  viewportSize,
} from './popover.js';

/** Narrow viewport where the sheet treatment may apply (mirrors index.css). */
const MOBILE_QUERY = '(max-width: 40rem)';

/**
 * Singleton portal mount for all combo popovers. Mounted inside the React
 * root element (not document.body) so synthetic events keep working, with
 * body fallback. `position: fixed` children still lay out against the visual
 * viewport because no ancestor creates a transform/filter/contain context.
 */
let comboPortalNode = null;
function getComboPortal() {
  if (typeof document === 'undefined') return null;
  if (!comboPortalNode || !comboPortalNode.isConnected) {
    comboPortalNode = document.createElement('div');
    comboPortalNode.className = 'combo-portal';
    const mount = document.getElementById('root') ?? document.body;
    mount.appendChild(comboPortalNode);
  }
  return comboPortalNode;
}

/** Flatten grouped options to navigable rows, preserving group headers. */
function flattenOptions(options) {
  const rows = [];
  for (const option of options ?? []) {
    if (option && Array.isArray(option.items)) {
      rows.push({ header: option.group ?? '' });
      for (const item of option.items) rows.push({ item });
    } else if (option) {
      rows.push({ item: option });
    }
  }
  return rows;
}

function matchesQuery(item, q) {
  if (!q) return true;
  const haystack = `${item?.label ?? ''} ${item?.hint ?? ''} ${item?.value ?? ''}`.toLowerCase();
  return haystack.includes(q);
}

export function SearchableSelect({
  id,
  label,
  value,
  options = [],
  onChange,
  placeholder = 'Select…',
  searchable = true,
  minFilter = 7,
  disabled = false,
  hint = null,
  ariaLabel = null,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Viewport-aware geometry for the portalled popover (null until measured
  // on open, so the first paint never flashes at a wrong position).
  const [placement, setPlacement] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);
  const listId = useId();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  // Flatten once per options identity: option arrays are rebuilt by callers,
  // so every derived list below reads this single memoized flattening
  // instead of re-walking the tree on each render.
  const flat = useMemo(() => flattenOptions(options), [options]);
  const selected = useMemo(
    () => flat.map((r) => r.item).find((item) => item && item.value === value) ?? null,
    [flat, value],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return flat.filter((row) => row.header !== undefined || matchesQuery(row.item, q));
  }, [flat, query]);
  const navigable = useMemo(() => rows.filter((row) => row.item && !row.item.disabled), [rows]);
  // Clamp navigation into the visible list during render (no reset effect):
  // the active index always resolves to a visible option.
  const safeIndex = navigable.length === 0 ? 0 : Math.min(activeIndex, navigable.length - 1);

  // Full (unfiltered) option count decides the mobile surface: only LONG
  // lists become bottom sheets; short selectors stay compact popovers.
  // Based on the stable option set, never the live filter, so typing cannot
  // yank the surface out from under the user.
  const fullOptionCount = useMemo(() => flat.filter((r) => r.item).length, [flat]);
  const sheet = shouldUseSheet({ isMobile, optionCount: fullOptionCount });

  const showFilter = searchable && fullOptionCount > minFilter;

  function closeMenu() {
    setOpen(false);
    setPlacement(null);
  }

  function openMenu() {
    if (disabled) return;
    // Start keyboard navigation (and the open-time scroll below) at the
    // current selection, so long lists open AT the selected year/country
    // instead of stranding the user at the top. Done here in the opening
    // event — not in an effect — so no render-phase reset is needed.
    const selectedNav = navigable.findIndex((row) => row.item && row.item.value === value);
    setActiveIndex(selectedNav >= 0 ? selectedNav : 0);
    setOpen(true);
  }

  function commit(item) {
    if (!item || item.disabled) return;
    closeMenu();
    setQuery('');
    if (item.value !== value) onChange?.(item.value);
    buttonRef.current?.focus();
  }

  // Measure the trigger and place the popover before paint (no flash), then
  // scroll the selected option into view inside the internal scroller only.
  useLayoutEffect(() => {
    if (!open || sheet) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = viewportSize();
    setPlacement(
      computePopoverPlacement({
        trigger: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
        viewportW: viewport.width,
        viewportH: viewport.height,
        contentHeight: estimatePopoverHeight({ optionCount: fullOptionCount, showFilter }),
      }),
    );
  }, [open, sheet, fullOptionCount, showFilter]);

  // Reposition (never leave a stale position) on viewport change: resize,
  // orientation change, address-bar show/hide and keyboard-driven visual
  // viewport shifts. Throttled to animation frames; no continuous polling.
  useEffect(() => {
    if (!open || sheet) return undefined;
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        const viewport = viewportSize();
        setPlacement(
          computePopoverPlacement({
            trigger: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
            viewportW: viewport.width,
            viewportH: viewport.height,
            contentHeight: estimatePopoverHeight({ optionCount: fullOptionCount, showFilter }),
          }),
        );
      });
    };
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
    };
  }, [open, sheet, fullOptionCount, showFilter]);

  // Scrolling anywhere outside the trigger+popover closes the menu (an open
  // menu never holds a stale viewport position). Scrolls inside the option
  // list or from the trigger itself are ignored.
  useEffect(() => {
    if (!open || sheet) return undefined;
    const onScroll = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [open, sheet]);

  // Sheet mode locks the page behind the sheet; the option list keeps its
  // own internal scroller. Overflow (and only overflow) is restored on
  // close — scroll position is never rewritten, so the page cannot jump.
  useEffect(() => {
    if (!open || !sheet || typeof document === 'undefined') return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, sheet]);

  // Click-outside closes. The portal lives outside rootRef by design, so the
  // popover itself must be excluded explicitly.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        if (popoverRef.current && popoverRef.current.contains(event.target)) return;
        closeMenu();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open ]);

  // Focus the filter box on open (after the portalled popover has mounted).
  useEffect(() => {
    if (open && (sheet || placement)) inputRef.current?.focus();
  }, [open, placement, sheet]);

  function move(delta) {
    if (navigable.length === 0) return;
    setActiveIndex((prev) => (prev + delta + navigable.length) % navigable.length);
  }

  function handleListKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(navigable.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(navigable[safeIndex] ?? null);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      buttonRef.current?.focus();
    }
  }

  const activeId = navigable[safeIndex] ? `${listId}-opt-${safeIndex}` : undefined;

  // Keep the active option visible inside the scrollable list — including
  // the selected option on open, since openMenu starts navigation there.
  useEffect(() => {
    if (!open || !activeId) return;
    if (!sheet && !placement) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId, placement, sheet]);

  const portalNode = open ? getComboPortal() : null;
  const popoverReady = sheet || placement !== null;

  function renderPopover() {
    const anchoredStyle =
      !sheet && placement
        ? {
            ...(placement.top !== null ? { top: placement.top } : { bottom: placement.bottom }),
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }
        : undefined;
    return (
      <div
        ref={popoverRef}
        className={sheet ? 'combo-popover combo-popover-sheet' : `combo-popover combo-popover-portal${placement?.dir === 'up' ? ' combo-popover-up' : ''}`}
        role="presentation"
        style={anchoredStyle}
      >
        {showFilter ? (
          <input
            ref={inputRef}
            type="search"
            className="combo-filter"
            value={query}
            placeholder="Type to filter…"
            aria-label={`Filter ${typeof label === 'string' ? label : 'options'}`}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleListKeyDown}
          />
        ) : null}
        <ul
          className="combo-list"
          role="listbox"
          id={listId}
          aria-activedescendant={activeId}
          aria-label={typeof label === 'string' ? label : undefined}
          tabIndex={showFilter ? undefined : 0}
          onKeyDown={showFilter ? undefined : handleListKeyDown}
        >
          {rows.length === 0 ? (
            <li className="combo-empty" role="presentation">
              No matches.
            </li>
          ) : (
            rows.map((row, index) => {
              if (row.header !== undefined) {
                return (
                  <li key={`header-${index}`} className="combo-group" role="presentation" aria-hidden="true">
                    {row.header}
                  </li>
                );
              }
              const item = row.item;
              if (item.disabled) {
                return (
                  <li
                    key={item.value}
                    className="combo-option combo-option-disabled"
                    role="option"
                    aria-selected={false}
                    aria-disabled="true"
                    title={item.disabledReason ?? undefined}
                  >
                    <span>{item.label}</span>
                    {item.disabledReason ? <span className="combo-option-note">{item.disabledReason}</span> : null}
                  </li>
                );
              }
              const navIndex = navigable.indexOf(item);
              const active = navIndex === safeIndex;
              const selectedRow = item.value === value;
              return (
                <li
                  key={item.value}
                  id={`${listId}-opt-${navIndex}`}
                  className={[
                    'combo-option',
                    active ? 'combo-option-active' : '',
                    selectedRow ? 'combo-option-selected' : '',
                  ].filter(Boolean).join(' ')}
                  role="option"
                  aria-selected={selectedRow}
                  onMouseDown={(event) => {
                    // Commit before blur/click-outside can close the list.
                    event.preventDefault();
                    commit(item);
                  }}
                  onMouseEnter={() => setActiveIndex(navIndex)}
                >
                  <span className="combo-label">{item.label}</span>
                  {item.hint ? <span className="combo-option-note">{item.hint}</span> : null}
                  {selectedRow ? (
                    <span className="combo-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </div>
    );
  }

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="combo" ref={rootRef}>
        <button
          ref={buttonRef}
          id={id}
          type="button"
          className="combo-button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          disabled={disabled}
          onClick={() => {
            if (open) closeMenu();
            else openMenu();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              closeMenu();
              return;
            }
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') && !open) {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <span className="combo-value">{selected ? selected.label : <span className="muted">{placeholder}</span>}</span>
          <span className="combo-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && portalNode && popoverReady ? createPortal(renderPopover(), portalNode) : null}
      </div>
    </Field>
  );
}

export default SearchableSelect;
