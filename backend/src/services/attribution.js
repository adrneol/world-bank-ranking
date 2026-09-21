/**
 * SOURCE ATTRIBUTION.
 *
 * Every response that reports a rank carries the same attribution, so the
 * application's calculated rank can never be presented as a rank published by the
 * World Bank (specification section 2).
 */

import { FOCUS_COUNTRY, SOURCE_INFO, config } from '../config.js';

export function sourceAttribution() {
  return {
    provider: SOURCE_INFO.provider,
    dataset: SOURCE_INFO.dataset,
    apiDocumentation: SOURCE_INFO.apiDocumentation,
    wording: SOURCE_INFO.rankWording,
    disclaimer: SOURCE_INFO.rankDisclaimer,
    focusCountry: { ...FOCUS_COUNTRY },
    apiBaseUrl: config.worldBank.baseUrl,
  };
}

export default { sourceAttribution };