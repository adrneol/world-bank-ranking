const inferred = new WeakMap();
const kindOf = cell => {
  if (cell.dataset.columnKind && cell.dataset.columnKind !== inferred.get(cell)) return cell.dataset.columnKind;
  const label = cell.textContent.trim().toLowerCase();
  if (/^(year|start year|middle year|end year)$/.test(label)) return 'year';
  if (/rank|position/.test(label)) return 'rank';
  if (/iso3|iso code/.test(label)) return 'iso3';
  if (/^(country|economy|economies|country\s*\/\s*iso3)$/.test(label)) return 'country';
  if (/period|interval/.test(label)) return 'period';
  if (/started|completed|finished|timestamp|utc|checked at/.test(label)) return 'timestamp';
  if (/status|outcome|trigger|publication/.test(label)) return 'status';
  if (/indicator|metric|measurement|basis/.test(label)) return 'metric';
  if (/unit/.test(label)) return 'unit';
  if (/percent|rate|yoy|growth|%/.test(label)) return 'rate';
  if (cell.classList.contains('num') || /value|amount|count|denominator|total|retrieved|upserted|skipped|changed|failed|checked|duration/.test(label)) return 'number';
  return 'description';
};

/** Presentation metadata only; supports grouped headers and row/column spans. */
export function applyTablePolicy(table) {
  if (!table?.tHead) return;
  const grid = [];
  [...table.tHead.rows].forEach((row, r) => {
    grid[r] ??= [];
    let col = 0;
    [...row.cells].forEach(cell => {
      while (grid[r][col]) col += 1;
      const kind = kindOf(cell);
      if (!cell.dataset.columnKind || cell.dataset.columnKind === inferred.get(cell)) inferred.set(cell, kind);
      cell.dataset.columnKind = kind;
      for (let y = r; y < r + cell.rowSpan; y += 1) {
        grid[y] ??= [];
        for (let x = col; x < col + cell.colSpan; x += 1) grid[y][x] = kind;
      }
      col += cell.colSpan;
    });
  });
  const columns = grid.at(-1) ?? [];
  [...table.tBodies].flatMap(body => [...body.rows]).forEach(row => {
    let col = 0;
    [...row.cells].forEach(cell => {
      const headerKind = columns[col];
      const kind = cell.colSpan > 1 ? 'description' : cell.classList.contains('num') && !['year', 'rank', 'period', 'timestamp'].includes(headerKind) ? 'number' : headerKind ?? 'description';
      if (!cell.dataset.columnKind || cell.dataset.columnKind === inferred.get(cell)) { cell.dataset.columnKind = kind; inferred.set(cell, kind); }
      col += cell.colSpan;
    });
  });
}
