# Visual system

Aim for an institutional economic research publication with the navigability of a research tool. A scan should reveal the selected economy, indicator, unit, year range, comparable population and source. Give the principal result the strongest hierarchy and align annotations and evidence beneath it.

## Color, contrast and typography

- Preserve the existing neutral light canvas and dark navy masthead. For the dark theme, start with midnight slate, desaturated blue-charcoal or graphite. Evaluate the user's starting tokens: #111B23 canvas, #182631 elevated, #20313C secondary, #DCE5E8 text, #A7B8C0 secondary text, #77AAA8 teal, and #C5A574 warm highlight. Refine actual token pairs on their intended surfaces. Use subdued background tiers and avoid a white canvas, a pure black foundation, or large areas of pure-white text.
- Aim for WCAG 2.2 AA. Verify at least 4.5:1 for ordinary text and 3:1 for large text and applicable component boundaries/meaningful graphics. Check labels, disabled context, selection, focus, tooltip backgrounds and each series against actual chart fill. Reserve status colors for status and pair them with text or shape. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- Use a highly legible sans-serif such as Instrument Sans, Inter or Source Sans 3. A restrained serif such as Spectral may work for selected editorial titles. Use tabular numerals and right alignment in numeric columns, align signs/decimals and label units. Prefer comfortable label sizes, readable weight, and line lengths suited to research prose. Keep font delivery light.
- Use spacing tiers for label/value pairs, related groups and sections. Prefer thin rules, consistent column anchors, modest radii and a small number of surface levels. Keep primary controls near their outputs and reserve compact layouts for evidence tables. Stack filters on mobile while retaining state and clear context.

## Layout and restraint

- Use graphite for the dark canvas, differentiated analytical surfaces, warm-neutral evidence accents and legible chart palettes. Preserve the navy masthead and neutral light surfaces. Use typography and rules to distinguish primary values, comparison context and reference evidence.

- Overview prioritizes the focus country, period and indicator. Compare puts the entities and measurement basis in reading order before the results. Status and Methodology make source vintage, retrieval, coverage and methods easy to scan. Movement gives one analytical conclusion followed by its context and evidence.
- Avoid glassmorphism, frosted panels, blur, gradient decoration, neon or purple/pink accents, oversized rounded cards, shadows as hierarchy, card nesting, decorative charts, arbitrary icons and ornamental motion. Density should reflect the amount of evidence. Keep controls and clickable rows recognizable.
- Animation should explain a state transition and respect reduced motion. Keep hover, focus, checked and selected states distinct. Avoid chart entrance animations, excessive point markers, layout shifts and unnecessary frameworks. Check bundle and interaction costs for any structural change.
- Keep text, surfaces, borders, states and chart colors in semantic tokens. Keep chart colors identifiable in both themes and verify their actual contrast. Place an icon-only theme switch in the header with an action label and visible focus. Keep theme transitions short and paint-only, and disable them for reduced motion. Existing tokens and chart variables live in [index.css](../../../../frontend/src/index.css) and [chartTheme.js](../../../../frontend/src/components/charts/chartTheme.js). Inspect reuse opportunities before changing them. A token proposal is a design decision, not a contrast verification.
