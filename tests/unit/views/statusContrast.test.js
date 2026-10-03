const fs = require('fs');
const path = require('path');
const { mix, contrast } = require('../../../services/color');
const paletteService = require('../../../services/paletteService');

/**
 * Status badges (Active, Scheduled, Expired, Banned…) are text on a tint of the same color. The palette tokens are
 * readable on the page background, but the tint lowers the contrast: every built-in palette has to keep 4.5:1
 * on the tint, over the page and over a card. paletteService.tokens() gives each badge text color (--status-*-text);
 * the tint share comes from tokens.css, so this follows the CSS.
 */
const TOKENS = fs.readFileSync(path.join(__dirname, '../../../public/css/tokens.css'), 'utf8');
const rootBlock = TOKENS.slice(TOKENS.indexOf(':root'), TOKENS.indexOf('}', TOKENS.indexOf(':root')));

function tintShare(name) {
  return Number(rootBlock.match(new RegExp(`${name}:\\s*color-mix\\(in srgb, var\\(--[a-z-]+\\) (\\d+)%, transparent\\)`))[1]) / 100;
}

const palettes = ['dark', 'light'].flatMap(mode => paletteService.listPalettes(mode, { builtInOnly: true }));
const STATUSES = { active: '--primary', warning: '--warning', error: '--destructive' };

describe.each(palettes.map(p => [p.id, p]))('%s', (id, palette) => {
  const tokens = paletteService.tokens(palette);

  it.each(Object.keys(STATUSES))('%s badge text is readable on its tint (page and card)', (status) => {
    const base = tokens[STATUSES[status]];
    const text = tokens[`--status-${status}-text`];
    expect(text).toMatch(/^#[0-9a-f]{6}$/);
    const tint = tintShare(`--status-${status}-bg`);
    for (const surface of [tokens['--background'], tokens['--card']]) {
      expect(contrast(text, mix(surface, base, tint))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the palette\'s own color where it already reads', () => {
    if (contrast(tokens['--primary'], mix(tokens['--card'], tokens['--primary'], tintShare('--status-active-bg'))) >= 4.5
      && contrast(tokens['--primary'], mix(tokens['--background'], tokens['--primary'], tintShare('--status-active-bg'))) >= 4.5) {
      expect(tokens['--status-active-text']).toBe(tokens['--primary']);
    }
  });
});
