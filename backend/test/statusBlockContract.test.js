/**
 * PHASE-4 R-01 REGRESSION GATE: shared StatusBlock contract.
 *
 * The six Phase-5 Movement families once passed unsupported props
 * (title/message/action) that StatusBlock silently ignored, rendering
 * loading/error states as nothing. This static gate fails loudly if any
 * StatusBlock usage drifts off the contract again — no DOM framework needed.
 *
 * Contract (frontend/src/components/ui.jsx): loading, error, empty,
 * emptyText, onRetry, sectionName. Nothing else.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');

function walkJsx(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsx(full));
    else if (/\.jsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Extract every <StatusBlock ...> / <StatusBlock ... /> tag's prop text. */
function statusBlockTags(source) {
  const tags = [];
  const pattern = /<StatusBlock([\s\S]*?)(?:\/>|>)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) tags.push(match[1]);
  return tags;
}

const ALLOWED_PROPS = new Set(['loading', 'error', 'empty', 'emptyText', 'onRetry', 'sectionName']);
const FORBIDDEN_PROPS = ['title', 'message', 'action'];

test('StatusBlock declares exactly the six-prop contract', () => {
  const ui = fs.readFileSync(path.join(FRONTEND_SRC, 'components', 'ui.jsx'), 'utf8');
  const decl = /export function StatusBlock\(\{([^}]*)\}\)/.exec(ui);
  assert.ok(decl, 'StatusBlock definition found');
  const declared = decl[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(new Set(declared), ALLOWED_PROPS);
});

test('no StatusBlock usage passes unsupported props anywhere in the frontend', () => {
  const offenders = [];
  for (const file of walkJsx(FRONTEND_SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const tag of statusBlockTags(source)) {
      // Strip string literals/JSX expression bodies so words inside messages
      // (e.g. an emptyText sentence) can never false-positive.
      const scrubbed = tag
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
        .replace(/\{[^}]*\}/g, '{}');
      for (const prop of FORBIDDEN_PROPS) {
        if (new RegExp(`\\b${prop}=`).test(scrubbed)) {
          offenders.push(`${path.relative(FRONTEND_SRC, file)}: ${prop}=`);
        }
      }
      const names = [...scrubbed.matchAll(/(\w+)=/g)].map((m) => m[1]);
      for (const name of names) {
        if (!ALLOWED_PROPS.has(name)) offenders.push(`${path.relative(FRONTEND_SRC, file)}: unexpected ${name}=`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'every StatusBlock call stays on-contract');
});

test('all six Phase-5 Movement families render contract-correct states', () => {
  const families = {
    PricesMovement: 'Prices analysis',
    TradeMovement: 'Trade analysis',
    CapitalMovement: 'Capital Flow analysis',
    FxMovement: 'Exchange Rate analysis',
    ExternalMovement: 'External Sector analysis',
    PopulationMovement: 'Population analysis',
  };
  for (const [file, section] of Object.entries(families)) {
    const source = fs.readFileSync(path.join(FRONTEND_SRC, 'sections', `${file}.jsx`), 'utf8');
    const tags = statusBlockTags(source);
    assert.ok(tags.length >= 1, `${file} renders a StatusBlock`);
    assert.ok(
      tags.some((t) => t.includes(`sectionName="${section}"`)),
      `${file} names its analysis ("${section}")`,
    );
    assert.ok(
      tags.some((t) => /\bempty\b/.test(t) && t.includes('emptyText=')),
      `${file} renders the same-year notice through empty/emptyText`,
    );
    assert.ok(
      tags.some((t) => /\bloading=\{loading\}/.test(t) && /\berror=\{error\}/.test(t) && /\bonRetry=\{retry\}/.test(t)),
      `${file} wires loading/error/Retry through the shared contract`,
    );
  }
});
