---
name: economic-research-ui-design
description: Design or review the World Bank research application's economic charts, evidence tables, rankings, comparison flows, Movement layouts, and mobile or desktop interfaces. Use for visual or interaction work on analytical surfaces, including chart modes, dual-axis encoding, legends, tooltips, custom selectors and responsive evidence.
---

# Economic research UI design

Design for sustained reading and investigation. Use a premium institutional, editorial direction with low-glare dark surfaces, legible numeric typography, and restrained accents. Let the analytical result, measurement basis, period and source determine hierarchy. This project guidance governs visual decisions when working with generic frontend or composition advice.

Before moving a control, chart, or table, map its current information, behavior and evidence path. Preserve every analytical function, observation, measurement basis, control, unit, formula, cohort and rank explanation, coverage figure, missing reason, source and methodology statement, verification route and meaningful state. Disclosure can change placement and density while keeping the evidence findable and operable. For changes that affect a calculation, date window, data identity or unit contract, apply [the WDI data integrity skill](../wdi-libsql-data-integrity/SKILL.md).

- Use [Visual system](references/visual-system.md) for palette, typography, spacing and layout.
- Use [Charts and evidence](references/charts-and-evidence.md) for history, multi-series, rankings, tables, Compare and Movement.
- Use [Interaction and acceptance](references/interaction-and-acceptance.md) for controls, responsive behavior, accessibility and before/after verification.

## Project requirements

- Use the shared application-owned selection controls for dropdowns. Native browser select popups are prohibited. Preserve keyboard, touch and screen-reader operation. Prefer segmented controls for binary modes.
- Draw enabled annual series in one compact plot with one timeline, fixed-position value axes, and viewport-aware Auto scaling alongside Fixed selected-period scaling. Use bars for every applicable numeric series in Bar mode, including annual growth and inflation, and lines for every series in Line mode. Show subtle primary-axis gridlines and a clear zero reference when zero is in use.
- Encode dimensions with graphical style as well as color. Use solid lines and filled bars for economic values, and dashed or dotted lines and patterned bars for annual percentages. Reuse the plotted style in each legend marker. Add a short visual key below mixed-axis plots that identifies the style, unit family and axis side.
- Keep one concise active legend and one compact series control. Tooltips contain the year, short labels and formatted values with the necessary units. Keep exact precision, indicator codes and provenance in consolidated evidence and sources.
- Keep controls and analytical detail compact. Avoid redundant headings, decorative chips, oversized hover panels and unused space. Preserve observations, genuine zeros, gaps, units, measurement bases, calculations and provenance in every mode.

Reuse React and Recharts primitives that already preserve the required behavior. Treat design instructions as guidance for authorized work. A visual task does not authorize application logic, data, dependency or deployment changes.
