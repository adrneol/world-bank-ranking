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
 * Popover architecture — one shared anchored system for every dropdown
 * (years, countries, metrics, bases, groups, relation/sort): the popover
 * renders through a portal (never clipped by card/table overflow
 * ancestors) and positions viewport-aware (down when space allows, up near
 * the bottom edge, constrained otherwise — never hard-coded top:100%).
 * Mobile uses the same anchored menu with visual-viewport clamping. Search
 * is focused on explicit touch so opening a list leaves the keyboard closed.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Field } from './ui.jsx';
import {
  anchoredPlacement,
  estimatePopoverHeight,
  getPortalMount,
  viewportSize,
} from './popover.js';

/**
 * Portal mount for combo popovers: the shared singleton from popover.js
 * (inside the React root so synthetic events keep working; body fallback).
 */
function getComboPortal() {
  return getPortalMount();
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
  const listRef = useRef(null);
  const popoverRef = useRef(null);
  const touchOpen = useRef(false);
  const listId = useId();
  const valueId = useId();
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

  const fullOptionCount = useMemo(() => flat.filter((r) => r.item).length, [flat]);

  const showFilter = searchable && fullOptionCount > minFilter;

  function closeMenu() {
    setQuery('');
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
    const trigger = buttonRef.current;
    const anchor = trigger?.getBoundingClientRect().top;
    closeMenu();
    if (item.value !== value) onChange?.(item.value);
    trigger?.focus({ preventScroll: true });
    // Selecting a year can reflow the chart below the trigger. Preserve the
    // trigger's screen position if browser scroll anchoring follows that chart.
    if (anchor != null && item.value !== value) requestAnimationFrame(() => {
      if (!trigger.isConnected || document.activeElement !== trigger) return;
      const shift = trigger.getBoundingClientRect().top - anchor;
      if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: 'instant' });
    });
  }

  // Measure the trigger and place the popover before paint (no flash), then
  // scroll the selected option into view inside the internal scroller only.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPlacement(anchoredPlacement(rect, estimatePopoverHeight({ optionCount: fullOptionCount, showFilter })));
  }, [open, fullOptionCount, showFilter]);

  // Reposition (never leave a stale position) on viewport change: resize,
  // orientation change, address-bar show/hide and keyboard-driven visual
  // viewport shifts. Throttled to animation frames; no continuous polling.
  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    const reposition = (event) => {
      if (event.target instanceof Node && (popoverRef.current?.contains(event.target) || rootRef.current?.contains(event.target))) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        const viewport = viewportSize();
        if (rect.bottom <= viewport.offsetTop || rect.top >= viewport.offsetTop + viewport.height) {
          if (document.activeElement !== inputRef.current) { closeMenu(); return; }
        }
        setPlacement(anchoredPlacement(rect, estimatePopoverHeight({ optionCount: fullOptionCount, showFilter })));
      });
    };
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [open, fullOptionCount, showFilter]);

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
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open ]);

  const popoverReady = placement !== null;
  // Touch opens the list first. Tapping Search explicitly opens the keyboard.
  useEffect(() => {
    if (open && popoverReady) {
      const target = touchOpen.current ? listRef.current : inputRef.current ?? listRef.current;
      target?.focus({ preventScroll: true });
    }
  }, [open, popoverReady]);

  function move(delta) {
    if (navigable.length === 0) return;
    setActiveIndex((prev) => (Math.min(prev, navigable.length - 1) + delta + navigable.length) % navigable.length);
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
    } else if (event.key === 'Enter' || (event.key === ' ' && event.currentTarget === listRef.current)) {
      event.preventDefault();
      commit(navigable[safeIndex]?.item);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      buttonRef.current?.focus({ preventScroll: true });
    } else if (event.key === 'Tab') {
      if (event.shiftKey && event.currentTarget === listRef.current && inputRef.current) {
        event.preventDefault();
        inputRef.current.focus({ preventScroll: true });
        return;
      }
      closeMenu();
      buttonRef.current?.focus({ preventScroll: true });
    }
  }

  const activeId = navigable[safeIndex] ? `${listId}-opt-${safeIndex}` : undefined;

  // Keep the active option visible inside the scrollable list — including
  // the selected option on open, since openMenu starts navigation there.
  useEffect(() => {
    if (!open || !activeId) return;
    if (!popoverReady) return;
    const list = listRef.current;
    const option = document.getElementById(activeId);
    if (!list || !option) return;
    const viewport = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < viewport.top) list.scrollTop -= viewport.top - row.top;
    if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
  }, [open, activeId, popoverReady]);

  const portalNode = open ? getComboPortal() : null;

  function renderPopover() {
    const anchoredStyle =
      placement
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
        className={`combo-popover combo-popover-portal${placement?.dir === 'up' ? ' combo-popover-up' : ''}`}
        role="presentation"
        style={anchoredStyle}
      >
        {showFilter ? (
          <input
            ref={inputRef}
            type="search"
            className="combo-filter"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            enterKeyHint="search"
            value={query}
            placeholder="Type to filter…"
            aria-label={`Filter ${typeof label === 'string' ? label : 'options'}`}
            autoComplete="off"
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleListKeyDown}
          />
        ) : null}
        <ul
          ref={listRef}
          className="combo-list"
          role="listbox"
          id={listId}
          aria-activedescendant={activeId}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          tabIndex={showFilter ? -1 : 0}
          onKeyDown={handleListKeyDown}
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
              const navIndex = navigable.indexOf(row);
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
                  onClick={(event) => { if (event.detail === 0) commit(item); }}
                  onPointerMove={(event) => { if (event.pointerType === 'mouse') setActiveIndex(navIndex); }}
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
          aria-controls={open && popoverReady ? listId : undefined}
          aria-describedby={selected ? valueId : undefined}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          disabled={disabled}
          onPointerDown={(event) => { touchOpen.current = event.pointerType === 'touch'; }}
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
              touchOpen.current = false;
              openMenu();
            }
          }}
        >
          <span className="combo-value" id={valueId}>{selected ? selected.label : placeholder}</span>
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
