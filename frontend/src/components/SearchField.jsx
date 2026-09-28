/**
 * Shared search field.
 *
 * One consistent search experience: label + search input with immediate
 * onChange reporting, optional submit (Search button / Enter), and a Clear
 * button whenever a query is applied. Callers decide the filtering rhythm —
 * local lists apply `onChange` directly (immediate), API-backed searches
 * apply a debounced value — but the control looks and behaves the same.
 * Backend rank/numbering semantics are never touched here; the applied
 * query string is passed through verbatim.
 */

import { Field } from './ui.jsx';

export default function SearchField({
  id,
  label,
  value,
  onChange,
  onSubmit = null,
  appliedQuery = null,
  onClear = null,
  placeholder = 'Search…',
  hint = null,
}) {
  const applied = appliedQuery ?? value;
  const inner = (
    <span className="search-row">
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {onSubmit ? (
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      ) : null}
      {applied !== '' && onClear ? (
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </span>
  );
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {onSubmit ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          role="search"
          aria-label={typeof label === 'string' ? label : 'Search'}
          style={{ display: 'contents' }}
        >
          {inner}
        </form>
      ) : (
        inner
      )}
    </Field>
  );
}
