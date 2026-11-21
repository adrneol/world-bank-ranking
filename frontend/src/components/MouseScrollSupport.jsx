import { useEffect } from 'react';

export default function MouseScrollSupport() {
  useEffect(() => {
    const shiftWheel = event => {
      if (!event.shiftKey || event.deltaX) return;
      const region = event.target.closest?.('.failure-details-scroll, .table-scroll, .annual-plot-scroll, .chart-plot-scroll');
      if (!region || region.scrollWidth <= region.clientWidth + 1) return;
      const previous = region.scrollLeft;
      const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? region.clientWidth : 1;
      region.scrollLeft += event.deltaY * unit;
      if (region.scrollLeft !== previous) event.preventDefault();
    };
    document.addEventListener('wheel', shiftWheel, { passive: false });
    return () => document.removeEventListener('wheel', shiftWheel);
  }, []);
  return null;
}
