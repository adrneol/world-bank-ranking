import { useLayoutEffect, useRef, useState } from 'react';
import { applyTablePolicy } from './tablePolicy.js';

export function AnalyticalTable({ label, className = '', freezeYear = true, children }) {
  const region = useRef(null);
  const [edges, setEdges] = useState({ overflow: false, first: true, last: true });
  useLayoutEffect(() => {
    const element = region.current;
    applyTablePolicy(element.querySelector('table'));
    const measure = () => {
      const next = { overflow: element.scrollWidth > element.clientWidth + 1,
        first: element.scrollLeft <= 1, last: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 };
      setEdges(previous => previous.overflow === next.overflow && previous.first === next.first && previous.last === next.last ? previous : next);
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => { element.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [children]);
  return (
    <div className="analytical-table-shell">
      {edges.overflow ? <div className="table-scroll-actions" role="group" aria-label={label + ' horizontal navigation'}>
        <button type="button" className="btn btn-secondary" aria-label="Scroll table left" disabled={edges.first}
          onClick={() => region.current.scrollBy({ left: -region.current.clientWidth * 0.7 })}>←</button>
        <button type="button" className="btn btn-secondary" aria-label="Scroll table right" disabled={edges.last}
          onClick={() => region.current.scrollBy({ left: region.current.clientWidth * 0.7 })}>→</button>
      </div> : null}
    <div ref={region} className={`table-scroll analytical-table ${freezeYear ? 'freeze-year' : ''} ${className}`}
      role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
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
