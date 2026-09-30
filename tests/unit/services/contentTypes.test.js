const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { CONTENT_TYPES, enabledTypes, isTypeEnabled } = require('../../../services/contentTypes');

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('enabledTypes', () => {
  it('lists every type while all features are on', () => {
    expect(enabledTypes()).toEqual(Object.keys(CONTENT_TYPES));
  });

  it('leaves out the types whose feature is switched off, read live', () => {
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { pastes: false, files: false } }));
    configService.reload();
    expect(enabledTypes()).toEqual(['url', 'bundle']);
  });
});

describe('isTypeEnabled', () => {
  it('is true for a known type whose feature is on (links have no switch)', () => {
    expect(isTypeEnabled('url')).toBe(true);
    expect(isTypeEnabled('paste')).toBe(true);
  });

  it('is false for an unknown type or a switched-off feature', () => {
    expect(isTypeEnabled('users')).toBe(false);
    expect(isTypeEnabled(undefined)).toBe(false);
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { pastes: false } }));
    configService.reload();
    expect(isTypeEnabled('paste')).toBe(false);
    expect(isTypeEnabled('url')).toBe(true);
  });
});
