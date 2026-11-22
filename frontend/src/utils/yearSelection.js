export const automaticYear = value => value == null || value === '' || ['latest','auto'].includes(value);
export const selectedYear = (value, fallback) => automaticYear(value) ? fallback : /^\d{4}$/.test(String(value)) ? Number(value) : fallback;
export function latestPeriod(years) {
  const end=years.at(-1)??null;
  return {start:years.length>1 ? (years.find(year=>year>=end-10 && year<end)??years[0]) : null,end};
}
export function selectedPeriod(years,startValue,endValue) {
  const end=selectedYear(endValue,years.at(-1)??null);
  const start=selectedYear(startValue,latestPeriod(years.filter(year=>year<=end)).start);
  return {start,end:automaticYear(endValue) && start!=null && end<=start ? null:end};
}
