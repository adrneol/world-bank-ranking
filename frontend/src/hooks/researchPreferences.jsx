import { useMemo, useState } from 'react';
import { createPreferenceStore, ResearchPreferenceContext } from './researchPreferences.js';

/** Session-only bounded UI preferences, surviving published-data remounts. */
export function ResearchPreferences({scope,children}) {
  const [store]=useState(()=>createPreferenceStore());
  const value=useMemo(()=>({store,scope}),[store,scope]);
  return <ResearchPreferenceContext.Provider value={value}>{children}</ResearchPreferenceContext.Provider>;
}
