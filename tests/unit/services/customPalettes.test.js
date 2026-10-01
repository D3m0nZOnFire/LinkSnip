const fs = require('fs');
const path = require('path');
const { parse: parseToml } = require('smol-toml');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const paletteService = require('../../../services/paletteService');
const { PaletteError } = paletteService;

const COLORS = { accent: '#3b82f6', background: '#0b1220', foreground: '#e6edf3', red: '#ef4444', yellow: '#f59e0b' };
const toml = (fields) => Object.entries(fields).map(([k, v]) => `${k} = "${v}"`).join('\n');
const write = (file, text) => {
  fs.mkdirSync(paths.PALETTES_DIR, { recursive: true });
  fs.writeFileSync(path.join(paths.PALETTES_DIR, file), text);
};

let warn;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  fs.rmSync(paths.PALETTES_DIR, { recursive: true, force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  paletteService.reload();
});

describe('palette files in DATA_DIR/palettes', () => {
  it('are listed with the built-in ones, by mode, marked custom', () => {
    write('company.toml', toml({ name: 'Company', mode: 'dark', ...COLORS }));
    paletteService.reload();

    const palette = paletteService.getPalette('company');
    expect(palette).toMatchObject({ id: 'company', name: 'Company', mode: 'dark', builtIn: false, colors: COLORS });
    expect(paletteService.listPalettes('dark').map(p => p.id)).toContain('company');
    expect(paletteService.listPalettes('light').map(p => p.id)).not.toContain('company');
  });

  it('take an Omarchy colors.toml as it is (file name = id)', () => {
    write('my-omarchy-theme.toml', fs.readFileSync(path.join(paths.PROJECT_ROOT, 'config/palettes/omarchy/nord.toml'), 'utf8'));
    paletteService.reload();
    expect(paletteService.getPalette('my-omarchy-theme')).toMatchObject({ name: 'My Omarchy Theme', mode: 'dark' });
  });

  it('show up within a few seconds without a restart, like settings.json', () => {
    paletteService.reload();
    write('later.toml', toml({ mode: 'light', ...COLORS, background: '#ffffff', foreground: '#111111' }));
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 2500);
    expect(paletteService.getPalette('later')).not.toBeNull();
    clock.mockRestore();
  });

  it('skip a broken file, naming the file and the problem, and warn once', () => {
    write('broken.toml', toml({ mode: 'dark', accent: 'blue' }));
    write('fine.toml', toml({ mode: 'dark', ...COLORS }));
    paletteService.reload();

    expect(paletteService.getPalette('broken')).toBeNull();
    expect(paletteService.getPalette('fine')).not.toBeNull();
    const [problem] = paletteService.problems();
    expect(problem.file).toBe('broken.toml');
    expect(problem.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^accent must be a color/)]));
    paletteService.reload();
    expect(warn.mock.calls.filter(c => String(c[0]).includes('broken.toml'))).toHaveLength(1);
  });

  it('skip a file whose name is not a usable id', () => {
    write('Company Blue.toml', toml({ mode: 'dark', ...COLORS }));
    paletteService.reload();
    expect(paletteService.problems()).toEqual([
      { file: 'Company Blue.toml', errors: [expect.stringMatching(/file name must be lowercase letters, digits and dashes/)] }
    ]);
  });

  it('never replace a built-in palette', () => {
    write('nord.toml', toml({ mode: 'dark', ...COLORS }));
    paletteService.reload();
    expect(paletteService.getPalette('nord').builtIn).toBe(true);
    expect(paletteService.problems()[0].errors).toEqual([expect.stringMatching(/same name as a built-in palette/)]);
  });

  it('are used by /theme.css when chosen', () => {
    write('company.toml', toml({ mode: 'dark', ...COLORS }));
    paletteService.reload();
    configService.updateSettings({ 'branding.darkPalette': 'company' });
    expect(paletteService.themeCss().css).toMatch(/:root\s*\{[^}]*--background: #0b1220;/);
  });
});

describe('createPalette', () => {
  it('writes DATA_DIR/palettes/<name>.toml in Omarchy format and lists it', () => {
    const palette = paletteService.createPalette({ name: 'Company Blue', mode: 'dark', colors: COLORS });
    expect(palette).toMatchObject({ id: 'company-blue', name: 'Company Blue', builtIn: false });

    const file = path.join(paths.PALETTES_DIR, 'company-blue.toml');
    expect(parseToml(fs.readFileSync(file, 'utf8'))).toEqual({ name: 'Company Blue', mode: 'dark', ...COLORS });
    expect(paletteService.getPalette('company-blue')).toMatchObject({ colors: COLORS });
  });

  it('picks a free id when the name is taken, also by a built-in palette', () => {
    paletteService.createPalette({ name: 'Company Blue', mode: 'dark', colors: COLORS });
    expect(paletteService.createPalette({ name: 'Company  blue!', mode: 'dark', colors: COLORS }).id).toBe('company-blue-2');
    expect(paletteService.createPalette({ name: 'Nord', mode: 'dark', colors: COLORS }).id).toBe('nord-2');
  });

  it('gives a name without letters or digits an id anyway', () => {
    expect(paletteService.createPalette({ name: '✨✨', mode: 'light', colors: COLORS }).id).toBe('palette');
  });

  it('refuses bad input, naming every problem', () => {
    let error;
    try {
      paletteService.createPalette({ name: ' ', mode: 'dusk', colors: { ...COLORS, accent: 'blue', red: undefined } });
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(PaletteError);
    expect(error.status).toBe(400);
    expect(error.errors).toEqual(expect.arrayContaining([
      'Name is required.',
      expect.stringMatching(/^mode must be "dark" or "light"/),
      expect.stringMatching(/^accent must be a color/),
      'red is missing'
    ]));
    expect(fs.existsSync(paths.PALETTES_DIR) ? fs.readdirSync(paths.PALETTES_DIR) : []).toEqual([]);
  });

  it('refuses a name over 40 characters', () => {
    expect(() => paletteService.createPalette({ name: 'x'.repeat(41), mode: 'dark', colors: COLORS })).toThrow(/at most 40/);
  });
});

describe('updatePalette', () => {
  it('changes the name and colors, keeping the id', () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    const updated = paletteService.updatePalette('company', { name: 'Company 2025', mode: 'dark', colors: { ...COLORS, accent: '#22c55e' } });
    expect(updated).toMatchObject({ id: 'company', name: 'Company 2025', colors: { accent: '#22c55e' } });
    expect(paletteService.getPalette('company').colors.accent).toBe('#22c55e');
  });

  it('changes the theme CSS of a palette in use', () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    configService.updateSettings({ 'branding.darkPalette': 'company' });
    const before = paletteService.themeCss().hash;
    paletteService.updatePalette('company', { name: 'Company', mode: 'dark', colors: { ...COLORS, background: '#000000' } });
    expect(paletteService.themeCss().hash).not.toBe(before);
  });

  it('refuses to change a built-in palette (403) or one that does not exist (404)', () => {
    expect(() => paletteService.updatePalette('nord', { name: 'N', mode: 'dark', colors: COLORS })).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => paletteService.updatePalette('nope', { name: 'N', mode: 'dark', colors: COLORS })).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('refuses to switch the mode of the palette in use for that mode (409)', () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    configService.updateSettings({ 'branding.darkPalette': 'company' });
    expect(() => paletteService.updatePalette('company', { name: 'Company', mode: 'light', colors: COLORS }))
      .toThrow(expect.objectContaining({ status: 409, message: expect.stringMatching(/dark palette in use/) }));
  });
});

describe('deletePalette', () => {
  it('removes the file', () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    paletteService.deletePalette('company');
    expect(paletteService.getPalette('company')).toBeNull();
    expect(fs.existsSync(path.join(paths.PALETTES_DIR, 'company.toml'))).toBe(false);
  });

  it('refuses a palette in use (409), a built-in one (403) and an unknown one (404)', () => {
    paletteService.createPalette({ name: 'Company', mode: 'light', colors: { ...COLORS, background: '#ffffff', foreground: '#111111' } });
    configService.updateSettings({ 'branding.lightPalette': 'company' });
    expect(() => paletteService.deletePalette('company')).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => paletteService.deletePalette('nord')).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => paletteService.deletePalette('nope')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('report (editor warnings)', () => {
  it('is empty for a palette that reads well as it is', () => {
    expect(paletteService.report(paletteService.getPalette('tokyo-night'))).toEqual([]);
  });

  it('says which colors were adjusted and why', () => {
    const notes = paletteService.report({ mode: 'dark', colors: { ...COLORS, accent: '#333a44', red: '#3355ff', yellow: '#22cc88' } });
    expect(notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'accent', from: '#333a44', to: expect.stringMatching(/^#/), message: expect.stringMatching(/too dark to read/) }),
      expect.objectContaining({ key: 'red', from: '#3355ff', message: expect.stringMatching(/not a red/) }),
      expect.objectContaining({ key: 'yellow', from: '#22cc88', message: expect.stringMatching(/not a warm color/) })
    ]));
  });
});
