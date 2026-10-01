const fs = require('fs');
const path = require('path');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const color = require('../../../services/color');
const paletteService = require('../../../services/paletteService');
const { PaletteError } = paletteService;

const OMARCHY = path.join(__dirname, '../../../config/palettes/omarchy');
const omarchyIds = fs.readdirSync(OMARCHY).filter(f => f.endsWith('.toml')).map(f => f.replace(/\.toml$/, ''));

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('parsePalette', () => {
  // Omarchy's own file (themes/matte-black/colors.toml), as hosts may drop it into DATA_DIR/palettes
  const OMARCHY_MATTE_BLACK = fs.readFileSync(path.join(__dirname, '../../fixtures/omarchy-matte-black.toml'), 'utf8');

  it("reads an Omarchy colors.toml as it is, keeping its other colors aside", () => {
    const p = paletteService.parsePalette(OMARCHY_MATTE_BLACK, { id: 'matte-black' });
    expect(p).toMatchObject({
      id: 'matte-black',
      name: 'Matte Black',
      mode: 'dark',
      colors: { background: '#121212', foreground: '#bebebe', accent: '#e68e0d', red: '#d35f5f', yellow: '#b91c1c' },
      extras: { green: '#ffc107', orange: '#c63d3d' }
    });
  });

  it('takes the name from the file when it has one', () => {
    const p = paletteService.parsePalette('name = "Company Blue"\nmode = "dark"\naccent = "#3b82f6"\nbackground = "#0b1220"\nforeground = "#e6edf3"\nred = "#ef4444"\nyellow = "#f59e0b"', { id: 'company-blue' });
    expect(p.name).toBe('Company Blue');
  });

  it('names every problem, by key', () => {
    let error;
    try {
      paletteService.parsePalette('mode = "dusk"\naccent = "orange"\nbackground = "#000"', { id: 'broken' });
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(PaletteError);
    expect(error.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/^mode must be "dark" or "light"/),
      expect.stringMatching(/^accent must be a color like #1a2b3c/),
      expect.stringMatching(/^foreground is missing/),
      expect.stringMatching(/^red is missing/),
      expect.stringMatching(/^yellow is missing/)
    ]));
  });

  it('reports a file that is not TOML', () => {
    expect(() => paletteService.parsePalette('accent = ', { id: 'x' })).toThrow(PaletteError);
  });
});

describe('built-in palettes', () => {
  const all = paletteService.listPalettes();

  it("are LinkSnip's two plus every Omarchy theme", () => {
    expect(all.map(p => p.id).sort()).toEqual(['linksnip-dark', 'linksnip-light', ...omarchyIds].sort());
    expect(omarchyIds.length).toBeGreaterThanOrEqual(22);
  });

  it("list LinkSnip's own first, then the rest by name", () => {
    expect(paletteService.listPalettes('dark')[0].id).toBe('linksnip-dark');
    expect(paletteService.listPalettes('light')[0].id).toBe('linksnip-light');
    const rest = paletteService.listPalettes('dark').slice(1).map(p => p.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('can be filtered by mode', () => {
    expect(paletteService.listPalettes('dark').every(p => p.mode === 'dark')).toBe(true);
    expect(paletteService.listPalettes('light').map(p => p.id)).toEqual(expect.arrayContaining(
      ['linksnip-light', 'catppuccin-latte', 'flexoki-light', 'lupine', 'rose-pine', 'white']
    ));
  });

  it('have readable names', () => {
    const name = (id) => paletteService.getPalette(id).name;
    expect(name('tokyo-night')).toBe('Tokyo Night');
    expect(name('catppuccin-latte')).toBe('Catppuccin Latte');
    expect(name('rose-pine')).toBe('Rosé Pine');
    expect(name('retro-82')).toBe('Retro 82');
  });

  it('are marked built in', () => {
    expect(all.every(p => p.builtIn)).toBe(true);
  });
});

describe('tokens', () => {
  const all = paletteService.listPalettes();

  it.each(all.map(p => [p.id, p]))('%s reads well everywhere', (id, palette) => {
    const t = paletteService.tokens(palette);
    const atLeast = (a, b, ratio) => expect({ pair: [a, b], ok: color.contrast(t[a], t[b]) >= ratio }).toEqual({ pair: [a, b], ok: true });
    atLeast('--foreground', '--background', 7);
    atLeast('--foreground', '--card', 7);
    atLeast('--muted-foreground', '--background', 4.5);
    atLeast('--muted-foreground', '--card', 4.5);
    atLeast('--primary', '--background', 4.5); // links and accent text
    atLeast('--primary', '--card', 4.5);
    atLeast('--primary-foreground', '--primary', 4.5); // text on accent buttons
    atLeast('--destructive', '--background', 4.5);
    atLeast('--destructive-foreground', '--destructive', 4.5);
    atLeast('--warning', '--background', 4.5);
  });

  it.each(all.map(p => [p.id, p]))('%s sets every theme color as #rrggbb', (id, palette) => {
    const t = paletteService.tokens(palette);
    for (const name of ['--background', '--foreground', '--card', '--card-foreground', '--secondary',
      '--secondary-foreground', '--muted', '--muted-foreground', '--border', '--border-hover', '--input',
      '--primary', '--primary-foreground', '--destructive', '--destructive-foreground', '--warning']) {
      expect(t[name]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps a theme's colors when they already read well", () => {
    const t = paletteService.tokens(paletteService.getPalette('tokyo-night'));
    expect(t['--background']).toBe('#1a1b26');
    expect(t['--foreground']).toBe('#a9b1d6');
    expect(t['--primary']).toBe('#7aa2f7');
    expect(t['--destructive']).toBe('#f7768e');
    expect(t['--warning']).toBe('#e0af68');
  });

  // The adapted files are shown as they are, and "Start from" copies them: no note in the editor
  it.each(all.map(p => [p.id, p]))('%s has colors that need no adjusting', (id, palette) => {
    expect(paletteService.report(palette)).toEqual([]);
    const t = paletteService.tokens(palette);
    expect([t['--foreground'], t['--primary'], t['--destructive'], t['--warning']])
      .toEqual([palette.colors.foreground, palette.colors.accent, palette.colors.red, palette.colors.yellow]);
  });


  // Delete buttons and errors must look dangerous

  it('lifts cards above a dark background and keeps them white-ish on a light one', () => {
    const dark = paletteService.tokens(paletteService.getPalette('linksnip-dark'));
    expect(color.luminance(dark['--card'])).toBeGreaterThan(color.luminance(dark['--background']));
    const light = paletteService.tokens(paletteService.getPalette('catppuccin-latte'));
    expect(color.luminance(light['--card'])).toBeGreaterThan(color.luminance(light['--background']));
  });
});

describe('themeCss', () => {
  it('uses LinkSnip Dark and LinkSnip Light by default', () => {
    const { css } = paletteService.themeCss();
    const dark = paletteService.tokens(paletteService.getPalette('linksnip-dark'));
    const light = paletteService.tokens(paletteService.getPalette('linksnip-light'));
    expect(css).toMatch(new RegExp(`:root\\s*\\{[^}]*--background: ${dark['--background']};`));
    expect(css).toMatch(new RegExp(`html\\[data-theme="light"\\]\\s*\\{[^}]*--background: ${light['--background']};`));
  });

  it('follows branding.darkPalette and branding.lightPalette', () => {
    configService.updateSettings({ 'branding.darkPalette': 'tokyo-night', 'branding.lightPalette': 'catppuccin-latte' });
    const { css } = paletteService.themeCss();
    expect(css).toMatch(/:root\s*\{[^}]*--background: #1a1b26;/);
    expect(css).toMatch(/html\[data-theme="light"\]\s*\{[^}]*--background: #eff1f5;/);
  });

  it('changes its hash when the palettes change', () => {
    const before = paletteService.themeCss().hash;
    configService.updateSettings({ 'branding.darkPalette': 'nord' });
    expect(paletteService.themeCss().hash).not.toBe(before);
    expect(paletteService.themeCss().hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('falls back to the default for an unknown palette or one of the wrong mode (a hand-edited settings.json)', () => {
    const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {});
    configService.updateSettings({ 'branding.darkPalette': 'no-such-theme', 'branding.lightPalette': 'tokyo-night' });
    const expected = paletteService.themeCss({ dark: 'linksnip-dark', light: 'linksnip-light' }).css;
    expect(paletteService.themeCss().css).toBe(expected);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe('checkChoice (Admin → Appearance)', () => {
  it('accepts a palette of the right mode', () => {
    expect(paletteService.checkChoice('dark', 'tokyo-night')).toBeNull();
    expect(paletteService.checkChoice('light', 'rose-pine')).toBeNull();
  });

  it('names the problem otherwise', () => {
    expect(paletteService.checkChoice('dark', 'nope')).toMatch(/no palette "nope"/);
    expect(paletteService.checkChoice('light', 'tokyo-night')).toMatch(/is a dark palette/);
  });
});
