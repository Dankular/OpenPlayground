import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ELEMENTS, ELEMENT_COUNT, SOURCE } from '../src/powder/elements';
import { BEHAVIORS, ENGINE_SIDE_UNPORTED, PARTIAL_PORTS } from '../src/powder/behaviors';

const SECTIONS = ['Walls', 'Electronics', 'Powered', 'Sensors', 'Force', 'Explosives', 'Gases', 'Liquids', 'Powders', 'Solids', 'Radioactive', 'Special', 'Life', 'Tools', 'Favorites', 'Decoration'];

/** Coverage table for research/POWDER.md, derived from the generated element table and the behaviour registry. */
export function coverageBlock(): string {
  const enabled = ELEMENTS.filter(e => e.Enabled);
  const ported = enabled.filter(e => e.hasUpdate && BEHAVIORS[e.key]?.update);
  const partial = ported.filter(e => PARTIAL_PORTS[e.key]);
  const staticOnly = enabled.filter(e => !e.hasUpdate && !ENGINE_SIDE_UNPORTED[e.key]);
  const missing = enabled.filter(e => (e.hasUpdate && !BEHAVIORS[e.key]?.update) || ENGINE_SIDE_UNPORTED[e.key]);
  const lines = [
    `Upstream commit \`${SOURCE.commit}\` (${SOURCE.license}).`, '',
    `* ${enabled.length} enabled elements in the generated table.`,
    `* ${staticOnly.length} have no update function upstream: their full behaviour is the static table plus the engine (movement, state changes, flammability, heat, pressure).`,
    `* ${ported.length} update functions are ported (${partial.length} with a documented omission).`,
    `* ${missing.length} elements are not functional beyond their static properties.`, '',
    '| Menu group | Static only | Ported | Ported with omissions | Not ported |', '| --- | --- | --- | --- | --- |',
  ];
  const cell = (list: typeof enabled, g: number) => list.filter(e => e.MenuSection === g).map(e => e.key).join(' ') || '–';
  for (let g = 0; g < SECTIONS.length; g++) {
    const row = [cell(staticOnly, g), cell(ported.filter(e => !PARTIAL_PORTS[e.key]), g), cell(partial, g), cell(missing, g)];
    if (row.every(v => v === '–')) continue;
    lines.push(`| ${SECTIONS[g]} | ${row.join(' | ')} |`);
  }
  lines.push('', 'Omissions in ported elements:', '', ...Object.entries(PARTIAL_PORTS).map(([k, v]) => `* \`${k}\`: ${v}`));
  lines.push('', 'Not ported, with reason where known:', '', ...missing.map(e => `* \`${e.key}\`${ENGINE_SIDE_UNPORTED[e.key] ? `: ${ENGINE_SIDE_UNPORTED[e.key]}` : ''}`));
  return lines.join('\n');
}

describe('powder coverage ledger', () => {
  it('research/POWDER.md carries the current generated coverage table', () => {
    const path = new URL('../research/POWDER.md', import.meta.url);
    const block = `<!-- coverage:start -->\n${coverageBlock()}\n<!-- coverage:end -->`;
    if (process.env.UPDATE_POWDER_DOC) {
      const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
      const next = /<!-- coverage:start -->[\s\S]*<!-- coverage:end -->/.test(text) ? text.replace(/<!-- coverage:start -->[\s\S]*<!-- coverage:end -->/, () => block) : text;
      writeFileSync(path, next);
    }
    expect(readFileSync(path, 'utf8')).toContain(block);
  });

  it('every ported behaviour is attached to a real, enabled element', () => {
    for (const key of Object.keys(BEHAVIORS)) {
      const e = ELEMENTS.find(x => x.key === key);
      expect(e, key).toBeDefined();
      expect(e!.Enabled, key).toBe(1);
    }
  });

  it('the element table matches the extractor output sanity checks', () => {
    expect(ELEMENTS[0].key).toBe('NONE');
    expect(ELEMENT_COUNT).toBe(195);
    expect(ELEMENTS.length).toBe(512);
    expect(ELEMENTS[300].Enabled).toBe(0);
    expect(ELEMENTS.find(e => e.key === 'WATR')!.default.temp).toBeCloseTo(293.15, 2);
    expect(ELEMENTS.find(e => e.key === 'LAVA')!.LowTemperatureTransition).toBe(512); // ST: special transition
  });
});
