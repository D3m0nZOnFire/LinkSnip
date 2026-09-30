const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { CONTENT_TYPES, enabledTypes } = require('../../../services/contentTypes');

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
