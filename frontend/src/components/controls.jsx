/**
 * Custom form controls (Phase 6 design system).
 *
 * SearchableSelect is the single replacement for browser-native <select>
 * wherever lists are long or grouped: an accessible combobox built on
 * button + popover + listbox (no new dependencies). Full keyboard contract:
 * type to filter, ArrowUp/Down/Home/End to move, Enter to select, Escape to
 * close, Tab to leave. Click-outside closes without layout jumps or scroll
 * locking. Disabled options carry their reason so an unavailable action is
 * explained, never silently offered.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Field } from './ui.jsx';

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
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();
  const selected = useMemo(
    () => flattenOptions(options).map((r) => r.item).find((item) => item && item.value === value) ?? null,
    [options, value],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return flattenOptions(options).filter((row) => row.header !== undefined || matchesQuery(row.item, q));
  }, [options, query]);
  const navigable = useMemo(() => rows.filter((row) => row.item && !row.item.disabled), [rows]);
  // Clamp navigation into the visible list during render (no reset effect):
  // the active index always resolves to a visible option.
  const safeIndex = navigable.length === 0 ? 0 : Math.min(activeIndex, navigable.length - 1);

  // Click-outside closes. No overlay, no scroll locking, no layout shift.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open ]);

  // Focus the filter box on open.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open ]);

  const showFilter = searchable && flattenOptions(options).filter((r) => r.item).length > minFilter;

  function commit(item) {
    if (!item || item.disabled) return;
    setOpen(false);
    setQuery('');
    if (item.value !== value) onChange?.(item.value);
    buttonRef.current?.focus();
  }

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
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  const activeId = navigable[safeIndex] ? `${listId}-opt-${safeIndex}` : undefined;

  // Keep the active option visible inside the scrollable list.
  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

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
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="combo-value">{selected ? selected.label : <span className="muted">{placeholder}</span>}</span>
          <span className="combo-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <div className="combo-popover" role="presentation">
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
                  return (
                    <li
                      key={item.value}
                      id={`${listId}-opt-${navIndex}`}
                      className={active ? 'combo-option combo-option-active' : 'combo-option'}
                      role="option"
                      aria-selected={item.value === value}
                      onMouseDown={(event) => {
                        // Commit before blur/click-outside can close the list.
                        event.preventDefault();
                        commit(item);
                      }}
                      onMouseEnter={() => setActiveIndex(navIndex)}
                    >
                      <span>{item.label}</span>
                      {item.hint ? <span className="combo-option-note">{item.hint}</span> : null}
                      {item.value === value ? (
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
        ) : null}
      </div>
    </Field>
  );
}

export default SearchableSelect;
