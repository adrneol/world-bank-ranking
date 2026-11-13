export function AnalyticalTable({ label, className = '', freezeYear = true, children }) {
  return (
    <div className={`table-scroll analytical-table ${freezeYear ? 'freeze-year' : ''} ${className}`}
      role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function MeasurementHeading({ label, unit, color }) {
  return (
    <span className="measurement-heading">
      <span>{color ? <span className="annual-series-swatch" style={{ '--series-color': color }} aria-hidden="true" /> : null}{label}</span>
      {unit ? <span className="measurement-unit">{unit}</span> : null}
    </span>
  );
}
