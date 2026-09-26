# Dropdown UI Redesign Notes (premium economics terminal)

Scope: global `SearchableSelect` combobox system (`controls.jsx` +
`index.css` combo classes). Accessibility contract preserved (combobox/
listbox roles, arrow/Home/End/Enter/Escape/Tab handling, click-outside,
focus-visible rings, screen-reader labels, mobile bottom-sheet popover).

## Design decisions
- Hover / keyboard-active: neutral wash (`--combo-hover`), never a blue
  color block.
- Selected row: 2px accent bar + semibold label + check; base rows reserve
  a transparent border so selection never shifts layout. No fill.
- Open trigger: navy ring via `[aria-expanded]` for clear open-state
  affordance (added in this task).
- Group headers: small caps, letterspaced, muted; tightened spacing.
- Scrollbar: thin, neutral, overlay-style (webkit + Firefox properties).
- Typography: 0.9rem rows, 1.4 line-height, ellipsis on label and note;
  note capped at 45% width.
- Motion: 100–120ms fades only; `prefers-reduced-motion` disables.
- Responsive: popover capped to viewport; bottom-sheet layout ≤40rem
  (pre-existing, retained).

## Non-goals (deliberately untouched)
- `.btn-primary` tab fills (separate tab component, intentional).
- `.combo-option-disabled` muted rows (legitimate in Compare operations,
  where unavailable actions carry reasons; Movement dropdowns no longer
  render disabled rows at all).
- Browser-native `<select>` usages elsewhere (out of scope).

## Render path
- Single memoized flatten per options identity; selected/rows/navigable
  derive from it. Metric lists memoize on registry generation; basis lists
  memoize on metric/years/registry version. Hydration swap (fallback →
  full registry) is inherent async behavior, now applied exactly once.
