/**
 * PHASE-5 R-08 REGRESSION GATE: shared mobile-card architecture.
 *
 * All six Phase-5 Movement families must present common/outside economy
 * lists through the single EconomyMobileList shell with backend-rank parity
 * (common → refRank, outside → showRank, the same values the desktop "#"
 * column shows), while keeping the desktop tables intact. Static gates —
 * no DOM framework — plus a structural contract on the shared shell.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECTIONS = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'sections');
const COMPONENTS = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'components');

const FAMILIES = [
  'PricesMovement',
  'TradeMovement',
  'CapitalMovement',
  'FxMovement',
  'ExternalMovement',
  'PopulationMovement',
];

const read = (dir, file) => fs.readFileSync(path.join(dir, `${file}.jsx`), 'utf8');

test('shared shell exports the card contract (list, fields, rank display)', () => {
  const shell = read(COMPONENTS, 'MovementCards');
  assert.ok(shell.includes('export function EconomyMobileList'), 'EconomyMobileList exported');
  assert.ok(shell.includes('export function CardField'), 'CardField exported');
  assert.ok(shell.includes('economy-cards'), 'RankMovement card CSS classes reused');
  assert.ok(shell.includes('role="list"') && shell.includes('role="listitem"'), 'list semantics kept');
  assert.ok(shell.includes('focusIso') && shell.includes('focusName'), 'generic focus highlighting');
  assert.ok(!shell.includes('MobileCardList'), 'no second card architecture introduced');
});

test('no legacy MobileCardList implementation remains anywhere', () => {
  for (const file of [...FAMILIES, 'RankMovement']) {
    const source = read(SECTIONS, file);
    assert.ok(!source.includes('function MobileCardList'), `${file}: local shell removed/generalized`);
  }
});

for (const file of FAMILIES) {
  test(`${file}: common + outside lists use the shared shell with backend-rank parity`, () => {
    const source = read(SECTIONS, file);
    assert.ok(source.includes('EconomyMobileList'), 'shared shell adopted');
    assert.ok(source.includes('useIsMobile()'), 'mobile branch gated on the shared 40rem hook');
    // Common cards show the reference-period backend rank — the desktop "#" value.
    assert.ok(source.includes('rankOf={(r) => r.refRank}'), 'common rankOf mirrors the desktop # column');
    // Outside cards show the displayed outside rank — the desktop "#" value.
    assert.ok(source.includes('rankOf={(r) => r.showRank}'), 'outside rankOf mirrors the desktop # column');
    // Common details share one code path with the desktop expandable row.
    assert.ok(
      source.includes('<dl className="dgrid">{renderKeyDetails(r)}</dl>'),
      'common details parity by construction (single renderer)',
    );
    // Desktop tables are preserved, not replaced.
    assert.ok(source.includes('table-scroll'), 'desktop table architecture retained');
    assert.ok(source.includes('<Pagination'), 'pagination interaction retained on mobile');
  });
}
