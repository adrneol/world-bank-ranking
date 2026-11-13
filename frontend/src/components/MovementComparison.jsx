import { createContext, useContext, useId, useState } from 'react';
import { SegmentedControl } from './charts/ChartControls.jsx';
import { SubTabs } from './Tabs.jsx';

const modes = [['observed', 'Observed'], ['common', 'Like-for-like']];

export function MovementModeControl({ mode, onChange, supported = true, scope = 'period' }) {
  if (!supported) return null;
  return <div className="movement-mode">
    <SegmentedControl label="Comparison universe" value={mode} options={modes} onChange={onChange} />
    <p className="footnote">{mode === 'observed'
      ? `Observed uses eligible economies for each ${scope}.`
      : `Like-for-like uses economies meeting the data requirements across every ${scope} shown.`}</p>
  </div>;
}

export function MovementPeriodResults({ label, children }) {
  return <div className="movement-periods" role="region" aria-label={label}>{children}</div>;
}

const ResearchContext = createContext(null);
const researchTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'coverage', label: 'Universe & coverage' },
  { id: 'decomposition', label: 'Decomposition' },
  { id: 'evidence', label: 'Evidence' },
];

export function MovementResearch({ sections, children }) {
  const [active, setActive] = useState('overview');
  const id = useId();
  return <ResearchContext value={{ active, id }}>
    <SubTabs options={researchTabs.filter(tab => sections.includes(tab.id))} active={active} onChange={setActive}
      label="Movement research" idPrefix={id} />
    {children}
  </ResearchContext>;
}

export function MovementResearchPanel({ section, children }) {
  const { active, id } = useContext(ResearchContext);
  return <div role="tabpanel" tabIndex={0} id={`${id}-${section}-panel`} aria-labelledby={`${id}-${section}-tab`} hidden={active !== section}>
    {children}
  </div>;
}
