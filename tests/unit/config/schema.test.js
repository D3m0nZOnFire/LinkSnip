const { SETTINGS, checkSetting } = require('../../../config/schema');

describe('branding settings', () => {
  it('exist with their defaults', () => {
    expect(SETTINGS['branding.name']).toMatchObject({ type: 'string', default: 'LinkSnip' });
    expect(SETTINGS['branding.tagline'].type).toBe('string');
    expect(SETTINGS['branding.darkPalette']).toMatchObject({ type: 'palette', mode: 'dark', default: 'linksnip-dark' });
    expect(SETTINGS['branding.lightPalette']).toMatchObject({ type: 'palette', mode: 'light', default: 'linksnip-light' });
  });

  it('are edited on the Appearance page', () => {
    for (const key of Object.keys(SETTINGS).filter(k => k.startsWith('branding.'))) {
      expect(SETTINGS[key].editor).toBe('appearance');
    }
  });
});

describe('checkSetting: string', () => {
  const spec = { type: 'string', minLength: 1, maxLength: 5 };

  it('accepts a string within the bounds', () => {
    expect(checkSetting(spec, 'abc')).toBeNull();
  });

  it('rejects other types and lengths out of bounds', () => {
    expect(checkSetting(spec, 3)).toMatch(/must be text/);
    expect(checkSetting(spec, null)).toMatch(/must be text/);
    expect(checkSetting(spec, '')).toMatch(/at least 1 character/);
    expect(checkSetting(spec, 'abcdef')).toMatch(/at most 5 characters/);
  });

  it('counts surrounding spaces out', () => {
    expect(checkSetting(spec, '   ')).toMatch(/at least 1 character/);
  });

  it('allows an empty value when there is no minimum', () => {
    expect(checkSetting({ type: 'string', maxLength: 5 }, '')).toBeNull();
  });
});

describe('checkSetting: palette', () => {
  const spec = { type: 'palette', mode: 'dark' };

  it('accepts a palette id', () => {
    expect(checkSetting(spec, 'tokyo-night')).toBeNull();
  });

  // Existence is checked where palettes are chosen; a deleted palette file must not invalidate settings.json
  it('rejects anything that is not an id', () => {
    for (const bad of ['Tokyo Night', '../etc', '', 7, null]) {
      expect(checkSetting(spec, bad)).toMatch(/must be a palette id/);
    }
  });
});
