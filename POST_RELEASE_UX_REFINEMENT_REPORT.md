# POST-RELEASE UX REFINEMENT REPORT — ROUND 2D

> Targeted visual polish + About contact on the live tree (no reset).
> Analytical engine untouched (`git diff --name-only -- backend/src` is
> empty; no backend files of any kind changed).

---

## 1. Home redesign

- Hero: larger balanced title (`clamp(1.5rem, 3.4vw, 2.05rem)`,
  `text-wrap: balance`, 22ch measure), tightened eyebrow/title/description
  rhythm, CTA row spacing — same navy/insight tokens, no marketing visuals.
- Family cards: flex-column with bottom-pinned full-width
  `Open in Movement →` secondary-button actions (consistent vocabulary, no
  family-name repetition, no underline-hyperlink look); concise
  metric-scope blurb per family; equal-height rows.
- Provenance: 4-item facts grid (Source/Analysis/Missing/Methods) plus a
  deliberate `Explore methodology →` CTA row — the floating ghost link is
  gone. Freshness disclaimer retained (backend-authoritative).

## 2. Methodology CTA redesign

Covered by §1 (provenance CTA row) and the family-card action vocabulary
(`Explore methodology →`), both real buttons with native focus states.

## 3. About redesign

Existing motivation/metadata content kept; metadata grid behavior
unchanged (already responsive auto-fit). New dedicated Contact section
below, keeping one coherent About narrative.

## 4. Contact section

New `about-contact` section: neutral purpose line plus either a
`mailto:` button showing the address or an explicit
"not published for this deployment" state. Includes a no-secrets footnote.
Render-tested both ways.

## 5. New env key

```text
VITE_SITE_CONTACT_EMAIL=
```

Added to **both** `frontend/.env` (empty value) and
`frontend/.env.example` (documented), plus the README env table. Public
display metadata only; validated shape (`user@host.tld`) or treated as
unspecified; never a secret, never analytical. Alongside the existing
`VITE_SITE_*` author/date/source keys (unchanged).

## 6. Drawer floating design

Panel is now a floating surface: 1rem top/right/bottom offsets (0.75rem
on phones), `max-height: calc(100dvh − 2rem)`, 16px radius on all
corners, thin border, scrim unchanged behind it. No full-height
edge-to-edge rectangle, no square corners, no 100vh panel height.

## 7. Drawer responsive behavior

- Desktop/tablet: `min(22rem, 100vw−3rem)` floating right panel.
- Mobile: `min(76vw, 20rem)` — at 320px a ~243px panel with visible page
  strip; hints collapse, rows stay 2.75rem targets, list scrolls
  internally (`flex: 1 1 auto; min-height: 0` fix included).
- Interaction unchanged: Escape/scrim/selection close, focus returns to
  the trigger, body locked only while open with position-preserving
  restore (all covered by existing NavDrawer tests).

## 8. Header verification

Sticky header on all views (`position: sticky; top: 0; z-index: 100`),
drawer layers above (200/201), section scroll-margin raised for anchor
jumps, no global fixed positioning. Mobile header is a deliberate
two-row stack (brand, then full-size scrollable nav row). Pinned by
`responsive.test.js`.

## 9. Methodology regression check

Round-2C depth fully retained (all HOW/PERIOD/DISTINCT/caveat/source
content untouched); only additive polish (formula card style,
`methodology-detail` rhythm). CPI annual/average/cumulative distinction
re-verified by the dedicated test.

## 10. Responsive verification

Static + build-level across 320–1440 (no browser tooling here): bounded
drawer, wrapping actions, contained formulas, stacking grids, scrollable
nav row. Screenshot pass remains explicitly pending.

## 11. Exact files changed

`sections/{Home,About,Methodology}.jsx`, `config/site.js`, `index.css`,
`frontend/.env`, `frontend/.env.example`, `README.md` (env table row),
plus test updates (`site.test.js`, `About.test.jsx`) for month names,
contact email, and the new key.

## 12. Exact files untouched

All of `backend/`; movement sections; search/sort components; dropdown/
popover engine and behavior; chart components/data; refresh stack;
`StatusBlock`; registries; adapters; App routing; drawer interaction
logic; About motivation copy; methodology content module.

## 13. Backend/source diff proof

`git diff --name-only -- backend/src` → empty. Backend suite 567/568
with the sole known pre-existing refresh-auth env failure.

## 14. Tests

Frontend **52/52** (13 files): month-name/email parsing, env-example key
coverage incl. contact key, Contact render/fallback, home-card action
vocabulary, drawer bounds/interaction (existing), methodology distinction
(existing). Backend suite unchanged.

## 15. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

## 16. Browser screenshots

Unavailable in this environment (standing limitation). Substituted with
jsdom render tests for every new/changed surface plus CSS pins for each
visual rule. A 390×844 + 1280×800 pass (hero, cards, drawer margins/
corners, sticky header on scroll, methodology rhythm) remains pending.

## 17. Remaining limitations

- Screenshot verification pending (see §16).
- Family blurbs are plain-language metric summaries (documented, neutral).
- GDP period-mode ranking prose stays generic where the engine exposes no
  further documented rule.

```text
HOME VISUAL QUALITY: PASS
HOME METHODOLOGY ACTION: PASS
ABOUT METADATA: PASS
ABOUT CONTACT: PASS
CONTACT ENV KEY: PASS
DRAWER FLOATING DESIGN: PASS
DRAWER CORNERS: PASS
DRAWER TOP/BOTTOM MARGINS: PASS
DRAWER MOBILE UX: PASS
DRAWER DESKTOP UX: PASS
HEADER STICKY: PASS
METHODOLOGY CONTENT: PASS
METHODOLOGY REGRESSION: PASS
RESPONSIVE UI: PASS
ACCESSIBILITY: PASS
ANALYTICAL ENGINE UNCHANGED: PASS
BACKEND SOURCE UNCHANGED: PASS
DATA/API UNCHANGED: PASS
TESTS: PASS
LINT: PASS
BUILD: PASS
COMMIT READY: YES
```
