import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsNarrowChart } from '../../hooks/useMediaQuery.js';
import { annualGeometry, barAxes, barCenter, plotInsets, valueAxis, visibleSegments, visibleValues } from './annualGeometry.js';
import { formatAnnualReadout, formatTickValue, isPercentageUnit } from './chartFormat.js';
import AnnualSeriesMarker, { AnnualPercentagePattern } from './AnnualSeriesMarker.jsx';
import { annualStroke } from './chartTheme.js';

function exact(value) {
  return value.toLocaleString('en-US', { maximumSignificantDigits: 21 });
}

function tickLabels(plot) {
  const { ticks } = plot.axis;
  const suffix = isPercentageUnit(plot.unit) ? '%' : '';
  for (let precision = 1; precision <= 5; precision += 1) {
    const labels = ticks.map(tick => formatTickValue(tick, plot.decimals, plot.unit, { precision }));
    if (new Set(labels).size === labels.length && labels.every(label => label.length <= 9)) return { labels };
  }
  // If full labels cannot fit, the rail labels bounds relative to a stated
  // reference. The tooltip, evidence and bounds disclosure stay in raw units.
  const reference = plot.axis.ticks[0];
  const offsets = plot.axis.ticks.map((tick) => tick === reference ? '0' + suffix : '+' + (tick - reference).toPrecision(2) + suffix);
  return { labels: offsets, offset: true };
}

function AxisRail({ plot, height, side }) {
  const { labels, offset } = tickLabels(plot);
  return (
    <div className={'annual-axis-rail annual-axis-' + side} aria-hidden="true">
      <div className="annual-axis-region" style={{ height }}>
        <span className="annual-axis-unit">{plot.unit}{offset ? ' · offset from first tick' : ''}</span>
        <svg width="100%" height={height}>
          {plot.axis.ticks.map((tick, index) => (
            <text key={tick} x={side === 'left' ? '94%' : '6%'} y={plot.axis.y(tick)}
              textAnchor={side === 'left' ? 'end' : 'start'} dominantBaseline="central">
              <title>{exact(tick)}</title>{labels[index]}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

function PlotMarks({ plot, geometry, selected, from, to }) {
  const { series, axis } = plot;
  const patternPrefix = useId();
  return series.map((item, slot) => {
    const { color, percentage } = item;
    const pattern = `${patternPrefix}-${slot}`;
    return <Fragment key={item.id}>
      {item.bars && percentage ? <defs><AnnualPercentagePattern id={pattern} color={color} /></defs> : null}
      <g data-series-id={item.id} data-axis={plot.id}>
        {item.bars ? item.values.map((value, index) => {
          if (!Number.isFinite(value)) return null;
          const center = barCenter(geometry, index, item.barSlot, item.barCount);
          const left = center - geometry.barWidth / 2;
          if (left > to || left + geometry.barWidth < from) return null;
          const baseline = axis.y(0);
          const top = axis.y(value);
          return <rect key={index} x={left} y={Math.min(baseline, top)} width={geometry.barWidth}
            height={Math.abs(top - baseline)} fill={percentage ? `url(#${pattern})` : color} />;
        }) : <>
          <path d={visibleSegments(item.values, geometry.x, from, to, plot.mode)
            .map(([x1, a, x2, b], index, segments) => {
              const previous = segments[index - 1];
              const joined = previous?.[2] === x1 && previous?.[3] === a;
              return (joined ? '' : 'M' + x1 + ',' + axis.y(a)) + 'L' + x2 + ',' + axis.y(b);
            }).join(' ')}
            stroke={color} fill="none" strokeLinejoin="round" {...annualStroke(item)} />
          {item.values.map((value, index) => Number.isFinite(value) &&
            geometry.x(index) + 4 >= from && geometry.x(index) - 4 <= to &&
            (index === selected || (!Number.isFinite(item.values[index - 1]) && !Number.isFinite(item.values[index + 1]))) ? (
              <circle key={index} cx={geometry.x(index)} cy={axis.y(value)} r={index === selected ? 3.4 : 2.2} fill={color} />
            ) : null)}
        </>}
      </g>
    </Fragment>;
  });
}

export default function UnifiedAnnualPlot({ years, regions, type = 'line', scale = 'linear', label = 'Annual observations', domainMode = 'auto' }) {
  const narrow = useIsNarrowChart();
  const scroller = useRef(null);
  const frame = useRef(null);
  const previousGeometry = useRef(null);
  const hint = useId();
  const axisKey = useId();
  const clipId = useId();
  const [viewport, setViewport] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [active, setActive] = useState(null);
  const [inspection, setInspection] = useState(null);
  const height = narrow ? 264 : 350;

  useEffect(() => {
    const element = scroller.current;
    if (!element) return undefined;
    const measure = () => { setViewport(element.clientWidth); setScroll(element.scrollLeft); };
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  const maxGroup = regions.reduce((count, region) => count + region.series.length, 0);
  const geometry = useMemo(() => annualGeometry(years.length, maxGroup, type, viewport), [years.length, maxGroup, type, viewport]);
  const { step } = geometry;
  useLayoutEffect(() => {
    const previous = previousGeometry.current;
    previousGeometry.current = { type, step };
    const node = scroller.current;
    if (previous && previous.type !== type && previous.step > 0 && node) {
      const anchor = active == null ? -1 : (active + 0.5) * previous.step - scroll;
      const selectedInView = anchor >= 0 && anchor <= viewport;
      if (!scroll && (!selectedInView || (active + 0.5) * step <= viewport)) return;
      const offset = selectedInView ? anchor : viewport / 2;
      node.scrollLeft = (scroll + offset) * step / previous.step - offset;
      setScroll(node.scrollLeft);
    }
  }, [type, step, scroll, viewport, active]);
  const viewLeft = Math.min(scroll, Math.max(0, geometry.width - viewport));
  const viewRight = viewport ? Math.min(geometry.width, viewLeft + viewport) : geometry.width;
  // During scroll, reuse the fixed domain and batch visible-window work to a frame.
  const domainLeft = domainMode === 'fixed' ? 0 : viewLeft;
  const domainRight = domainMode === 'fixed' ? geometry.width : viewRight;
  const bars = type === 'bar';
  const plots = useMemo(() => {
    let slot = 0;
    const groups = regions.map((region) => {
      const all = region.series.flatMap((item) => item.values).filter(Number.isFinite);
      const mode = !bars && !region.zeroLine && (scale === 'symlog' || (scale === 'log' && all.length && all.every(value => value > 0)))
        ? scale : 'linear';
      const series = region.series.map((item) => ({ ...item, bars, barSlot: slot++, barCount: maxGroup }));
      const visible = domainMode === 'auto' ? visibleValues(series, geometry, domainLeft, domainRight, mode) : all;
      return { ...region, series, mode, values: visible.length ? visible : all };
    });
    const axes = bars ? barAxes(groups.map(group => group.values), height) : groups.map(group =>
      valueAxis(group.values, height, { includeZero: group.zeroLine, mode: group.mode }));
    return groups.map((group, index) => ({ ...group, axis: axes[index] }));
  }, [regions, bars, maxGroup, scale, domainMode, domainLeft, domainRight, geometry, height]);
  if (!years.length || !plots.length) return null;

  const mixed = plots.length === 2 && !isPercentageUnit(plots[0].unit) && isPercentageUnit(plots[1].unit);
  const selected = active == null ? null : Math.min(active, years.length - 1);
  const visibleX = selected == null ? null : geometry.x(selected) - viewLeft;
  const readout = selected == null ? [] : plots.flatMap((plot) => plot.series.map((series) => ({
    ...series, display: formatAnnualReadout(series.values[selected], series.unit ?? plot.unit, series.decimals ?? plot.decimals),
  })));
  const reference = plots.find(plot => plot.zeroLine) ?? plots[0];
  const zeroAxes = bars ? [plots[0]] : reference.axis.lo <= 0 && reference.axis.hi >= 0 ? [reference] : [];
  const choose = (index) => setActive(Math.min(years.length - 1, Math.max(0, index)));
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setActive(null); setInspection(null); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? years.length - 1 :
      Math.min(years.length - 1, Math.max(0, (selected ?? Math.floor(viewLeft / geometry.step)) +
        (event.key === 'ArrowRight' ? 1 : -1)));
    setInspection('keyboard');
    choose(next);
    const node = scroller.current;
    const x = geometry.x(next);
    if (x < node.scrollLeft || x > node.scrollLeft + node.clientWidth) node.scrollLeft = x - node.clientWidth / 2;
  };
  const pointAt = (event, input) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setInspection(input);
    choose(Math.floor((event.clientX - rect.left) / geometry.step));
  };
  const onScroll = () => {
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (scroller.current) setScroll(scroller.current.scrollLeft);
    });
  };

  return <div className={'annual-plot-layout' + (plots[1] ? ' has-right-axis' : '')}>
    <div className="annual-plot-instructions">
      <p id={hint}>{domainMode === 'auto' ? 'Auto scales to visible years. Use Fixed to compare slopes across windows.' : 'Fixed scales to the selected period.'}{' '}
        <span>Scroll or use arrow keys to inspect years.</span></p>
      {viewport > 0 && geometry.width > viewport + 1 ? <div className="timeline-navigation" role="group" aria-label="Timeline navigation">
        <button type="button" className="btn btn-secondary" aria-label="Earlier years" disabled={viewLeft <= 1}
          onClick={() => scroller.current.scrollBy({ left: -Math.max(step, viewport - step) })}>←</button>
        <button type="button" className="btn btn-secondary" aria-label="Later years" disabled={viewRight >= geometry.width - 1}
          onClick={() => scroller.current.scrollBy({ left: Math.max(step, viewport - step) })}>→</button>
      </div> : null}
    </div>
    <AxisRail plot={plots[0]} height={height} side="left" />
    <div className="annual-plot-center">
      <div className="annual-plot-scroll" role="region" aria-label={label} aria-describedby={mixed ? `${hint} ${axisKey}` : hint}
        tabIndex={0} ref={scroller} onKeyDown={onKeyDown} onScroll={onScroll}>
        <div className="annual-plot-strip" style={{ width: geometry.width }}
          onPointerMove={(event) => { if (event.pointerType === 'mouse') pointAt(event, 'hover'); }}
          onClick={(event) => pointAt(event, 'selected')}
          onPointerLeave={() => { if (inspection === 'hover') setActive(null); }}>
          <svg className="annual-region-svg" width={geometry.width} height={height} aria-hidden="true">
            <defs><clipPath id={clipId}><rect width={geometry.width} height={height} /></clipPath></defs>
            {plots[0].axis.ticks.filter(tick => tick !== 0 || !zeroAxes.includes(plots[0])).map((tick) => <line className="annual-grid-line" key={tick}
              x1={0} x2={geometry.width} y1={plots[0].axis.y(tick)} y2={plots[0].axis.y(tick)} />)}
            {zeroAxes.map((plot) => (
              <line key={plot.id} className="annual-zero-line" data-axis={bars && plots[1] ? 'shared' : plot.id}
                x1={0} x2={geometry.width} y1={plot.axis.y(0)} y2={plot.axis.y(0)} />
            ))}
            {selected != null ? <line className="annual-cursor" x1={geometry.x(selected)} x2={geometry.x(selected)}
              y1={0} y2={height} /> : null}
            <g clipPath={'url(#' + clipId + ')'}>
              {plots.map((plot) => <PlotMarks key={plot.id} plot={plot} geometry={geometry}
                selected={selected} from={viewLeft} to={viewRight} />)}
            </g>
          </svg>
          <svg className="annual-timeline" width={geometry.width} height={plotInsets.timeline} aria-hidden="true">
            {years.map((year, index) => index % geometry.tickEvery === 0 || index === years.length - 1 ? (
              <text key={year} x={geometry.x(index)} y={18} textAnchor="middle">{year}</text>
            ) : null)}
          </svg>
        </div>
      </div>
      {visibleX != null && visibleX >= 0 && visibleX <= viewport ? (
        <div className="annual-tooltip" data-side={visibleX < viewport / 2 ? 'end' : 'start'}
          role={inspection === 'hover' ? undefined : 'status'}>
          <strong>{years[selected]}</strong>
          <dl>{readout.map((item) => <div key={item.id} style={{ '--series-color': item.color }}>
            <dt>{item.label}</dt><dd>{item.display}</dd>
          </div>)}</dl>
        </div>
      ) : null}
    </div>
    {plots[1] ? <AxisRail plot={plots[1]} height={height} side="right" /> : null}
    {mixed ? <p className="annual-axis-key" id={axisKey}>
      <span><AnnualSeriesMarker type={type} />{bars ? 'Solid bars' : 'Solid lines'} = Values · Left axis</span>
      <span><AnnualSeriesMarker type={type} percentage />{bars ? 'Patterned bars' : 'Dashed lines'} = Annual % · Right axis</span>
    </p> : null}
    <details className="annual-axis-bounds">
      <summary>Axis bounds</summary>
      <ul>{plots.map((plot, index) => <li key={plot.id}>{index ? 'Right' : 'Left'} axis · {plot.unit}:
        {' '}{exact(plot.axis.lo)} to {exact(plot.axis.hi)}</li>)}</ul>
    </details>
  </div>;
}
